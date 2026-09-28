import type { ClassifierInput } from "@/ai/classifier";
import { classifyDemo } from "@/ai/demo-classifier";

/** Classify a buyer reply. Uses the live model only if GROQ_API_KEY is set (Groq); otherwise the deterministic demo classifier. */
export async function POST(request: Request) {
  const input = (await request.json()) as ClassifierInput;
  if (!input?.primaryEvidence?.text || !input.primaryEvidence.timestamp) {
    return Response.json({ error: "primaryEvidence.text and timestamp required" }, { status: 400 });
  }
  if (process.env.GROQ_API_KEY) {
    const { LiveCaseClassifier } = await import("@/ai/live-classifier");
    return Response.json({ understanding: await new LiveCaseClassifier().classify(input) });
  }
  return Response.json({ understanding: classifyDemo(input) });
}
