/**
 * Optional live LLM classifier (server-only), via Groq. Used ONLY when GROQ_API_KEY is set.
 * The demo never depends on it.
 *
 * Output is constrained with Groq structured outputs (json_schema, strict: true — supported by
 * openai/gpt-oss-120b) and then re-validated with zod against the same CaseUnderstanding
 * schema the deterministic DemoCaseClassifier returns. Anything invalid, failed or declined
 * degrades to NEEDS_REVIEW (a person reads it) — never to an action.
 */
import Groq from "groq-sdk";
import { z } from "zod";
import { INVOICE_STATES, type CaseUnderstanding } from "@/domain/types";
import { CLASSIFIER_PROMPT_VERSION, type CaseClassifier, type ClassifierInput } from "./classifier";
import { loadPrompt } from "./prompt-registry";

export const LIVE_MODEL = process.env.RESOLVE_LIVE_MODEL ?? "openai/gpt-oss-120b";

const TEMPORAL_TYPES = ["EXACT_DATE", "DATE_RANGE", "AFTER_DATE", "RELATIVE_DATE", "AMBIGUOUS"] as const;
const BANDS = ["HIGH", "NEEDS_REVIEW"] as const;
const ROLES = ["IMMEDIATE", "REMAINDER", "TOTAL", "DISPUTED", "UNDISPUTED", "PAID", "UNSPECIFIED"] as const;
const BLOCKER_KINDS = ["GSTIN", "PO", "INVOICE_FORMAT", "SUPPORTING_DOC", "QUALITY", "QUANTITY", "RATE", "TDS", "CASH_FLOW", "PAYMENT_CLAIM", "UNKNOWN"] as const;

/** Strict-mode JSON schema: every property required, additionalProperties false, nullables as unions. */
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableDate = { type: ["string", "null"], description: "YYYY-MM-DD in Asia/Kolkata, or null" };

export const UNDERSTANDING_JSON_SCHEMA = obj({
  proposedState: { type: "string", enum: [...INVOICE_STATES] },
  confidenceBand: { type: "string", enum: [...BANDS] },
  extractedAmounts: {
    type: "array",
    items: obj({ rawText: { type: "string" }, amount: { type: "number" }, role: { type: "string", enum: [...ROLES] } }),
  },
  temporalExpressions: {
    type: "array",
    items: obj({
      rawText: { type: "string" },
      type: { type: "string", enum: [...TEMPORAL_TYPES] },
      normalizedDate: nullableDate,
      lowerBound: nullableDate,
      upperBound: nullableDate,
      confidenceBand: { type: "string", enum: [...BANDS] },
    }),
  },
  alternativeStates: { type: "array", items: { type: "string", enum: [...INVOICE_STATES] } },
  blockerKind: { type: "string", enum: [...BLOCKER_KINDS] },
  evidenceUsed: { type: "array", items: { type: "string" } },
  conciseExplanation: { type: "string" },
});

const Understanding = z.object({
  proposedState: z.enum(INVOICE_STATES),
  confidenceBand: z.enum(BANDS),
  extractedAmounts: z.array(z.object({ rawText: z.string(), amount: z.number(), role: z.enum(ROLES) })),
  temporalExpressions: z.array(
    z.object({
      rawText: z.string(),
      type: z.enum(TEMPORAL_TYPES),
      normalizedDate: z.string().nullable(),
      lowerBound: z.string().nullable(),
      upperBound: z.string().nullable(),
      confidenceBand: z.enum(BANDS),
    }),
  ),
  alternativeStates: z.array(z.enum(INVOICE_STATES)),
  blockerKind: z.enum(BLOCKER_KINDS),
  evidenceUsed: z.array(z.string()),
  conciseExplanation: z.string(),
});

export function renderPrompt(template: string, input: ClassifierInput): string {
  const supporting =
    input.supportingEvidence.map((e) => `- [${e.type} · ${e.id} · ${e.timestamp}] ${e.text}`).join("\n") || "(none)";
  const vars: Record<string, string> = {
    MESSAGE_TIMESTAMP: input.primaryEvidence.timestamp,
    PRIMARY_TYPE: input.primaryEvidence.type,
    PRIMARY_ID: input.primaryEvidence.id,
    PRIMARY_TEXT: input.primaryEvidence.text,
    SUPPORTING_EVIDENCE: supporting,
    INVOICE_NUMBER: input.invoice.invoiceNumber,
    INVOICE_AMOUNT: String(input.invoice.amount),
    OUTSTANDING_AMOUNT: String(input.invoice.outstandingAmount),
    DUE_AT: input.invoice.dueAt,
    BUYER_NAME: input.buyerName,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

function fallback(input: ClassifierInput, reason: string, provider: string): CaseUnderstanding {
  return {
    proposedState: "NEEDS_REVIEW",
    confidenceBand: "NEEDS_REVIEW",
    extractedAmounts: [],
    temporalExpressions: [],
    entities: { blockerKind: "UNKNOWN" },
    evidenceUsed: [input.primaryEvidence.id],
    conciseExplanation: `Live classifier unavailable (${reason}). A person should read this reply.`,
    providerError: reason,
    provider,
    promptVersion: CLASSIFIER_PROMPT_VERSION,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds Groq suggests waiting, from the retry-after header or the "try again in 1.1s" message. */
function retryAfterMs(err: InstanceType<typeof Groq.RateLimitError>): number {
  const header = Number(err.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = /try again in ([\d.]+)s/i.exec(err.message);
  return m ? Math.ceil(Number(m[1]) * 1000) : 5000;
}

export class LiveCaseClassifier implements CaseClassifier {
  readonly id = `groq:${LIVE_MODEL}`;
  private client: Groq;

  /**
   * `patient` (evaluation mode): wait out rate limits instead of degrading to NEEDS_REVIEW,
   * so a throttled call is never scored as a model prediction.
   */
  constructor(private opts: { patient?: boolean; maxWaits?: number } = {}) {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: opts.patient ? 0 : 2 });
  }

  async classify(input: ClassifierInput): Promise<CaseUnderstanding> {
    for (let attempt = 0; ; attempt++) {
      const u = await this.classifyOnce(input);
      if (!this.opts.patient || u.providerError !== "rate limited" || attempt >= (this.opts.maxWaits ?? 12)) return u;
      await sleep(this.lastWaitMs + 250);
    }
  }

  private lastWaitMs = 5000;

  private async classifyOnce(input: ClassifierInput): Promise<CaseUnderstanding> {
    const prompt = loadPrompt(CLASSIFIER_PROMPT_VERSION);
    try {
      const response = await this.client.chat.completions.create({
        model: LIVE_MODEL,
        messages: [{ role: "user", content: renderPrompt(prompt.text, input) }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "case_understanding", strict: true, schema: UNDERSTANDING_JSON_SCHEMA },
        },
      });
      const choice = response.choices[0];
      const content = choice?.message?.content;
      if (!content) return fallback(input, choice?.finish_reason ? `no output (${choice.finish_reason})` : "empty response", this.id);
      const parsed = Understanding.safeParse(JSON.parse(content));
      if (!parsed.success) return fallback(input, "output failed schema validation", this.id);
      const out = parsed.data;
      return {
        proposedState: out.proposedState,
        confidenceBand: out.confidenceBand,
        extractedAmounts: out.extractedAmounts,
        temporalExpressions: out.temporalExpressions.map((t) => ({
          rawText: t.rawText,
          type: t.type,
          normalizedDate: t.normalizedDate ?? undefined,
          lowerBound: t.lowerBound ?? undefined,
          upperBound: t.upperBound ?? undefined,
          confidenceBand: t.confidenceBand,
        })),
        entities: { blockerKind: out.blockerKind, alternativeStates: out.alternativeStates },
        evidenceUsed: out.evidenceUsed.length ? out.evidenceUsed : [input.primaryEvidence.id],
        conciseExplanation: out.conciseExplanation,
        provider: this.id,
        promptVersion: `${CLASSIFIER_PROMPT_VERSION}@${prompt.sha256.slice(0, 12)}`,
      };
    } catch (err) {
      if (err instanceof Groq.RateLimitError) {
        this.lastWaitMs = retryAfterMs(err);
        return fallback(input, "rate limited", this.id);
      }
      if (err instanceof Groq.APIError) return fallback(input, `API error ${err.status ?? ""}`.trim(), this.id);
      if (err instanceof SyntaxError) return fallback(input, "unparseable output", this.id);
      return fallback(input, "network error", this.id);
    }
  }
}

export function liveClassifierConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}
