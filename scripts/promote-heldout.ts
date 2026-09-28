/**
 * Promote reviewed candidates to the held-out set.
 *   npm run heldout:promote -- --reviewed-by "Your Name"
 * Records who reviewed the labels and the frozen prompt hash at promotion time.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLASSIFIER_PROMPT_VERSION } from "@/ai/classifier";
import { loadPromptLock } from "@/ai/prompt-registry";
import { HELDOUT_PATH, validateCases } from "@/evaluation/heldout-loader";
import type { CaseFile } from "@/evaluation/types";

const SRC = path.join(process.cwd(), "evaluation", "heldout-candidates.json");
const i = process.argv.indexOf("--reviewed-by");
const reviewer = i >= 0 ? process.argv[i + 1] : undefined;
if (!reviewer) {
  console.error('Usage: npm run heldout:promote -- --reviewed-by "Your Name"   (confirms you reviewed every label)');
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error("No evaluation/heldout-candidates.json — run `npm run heldout:draft` or write the cases by hand.");
  process.exit(1);
}
if (existsSync(HELDOUT_PATH)) {
  console.error("evaluation/heldout-cases.json already exists. A held-out set is evaluated once; delete it deliberately if you really mean to replace it.");
  process.exit(1);
}
const file = JSON.parse(readFileSync(SRC, "utf8")) as CaseFile;
const { errors } = validateCases(file);
if (errors.length) {
  console.error("Fix these before promoting:\n- " + errors.join("\n- "));
  process.exit(1);
}
const lock = loadPromptLock()[CLASSIFIER_PROMPT_VERSION];
const out: CaseFile = {
  meta: {
    ...file.meta,
    set: "heldout",
    heldOut: true,
    authoredBy: `${file.meta.authoredBy}; labels reviewed by ${reviewer}`,
    promptVersionFrozen: CLASSIFIER_PROMPT_VERSION,
    promptHashAtAuthoring: lock.sha256,
    warning: undefined,
  },
  cases: file.cases,
};
writeFileSync(HELDOUT_PATH, JSON.stringify(out, null, 2));
console.log(`Promoted ${file.cases.length} cases to evaluation/heldout-cases.json (prompt ${CLASSIFIER_PROMPT_VERSION} frozen at ${lock.sha256.slice(0, 12)}).`);
console.log("Next: npm run eval -- --set heldout --publish   and   npm run eval:live -- --set heldout --publish");
