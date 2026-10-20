// Re-check every stored summary against the CURRENT guardrails (e.g. after tightening the banned-phrase list).
// Failing summaries are marked rejected (kept for cost accounting) so the site falls back to the template.
// Usage: node scripts/ai-recheck.mjs   (local D1)
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BANNED } from "../worker/services/ai/validate.ts";

const run = (sql) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${sql}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0].results;
const rows = run("SELECT id, text_json FROM ai_explanations");
const updates = [];
let checked = 0;
for (const r of rows) {
  const t = JSON.parse(r.text_json);
  if (t.rejected) continue;
  checked++;
  const text = [t.summary, ...(t.key_points ?? [])].join(" \n");
  const hits = BANNED.filter((re) => re.test(text)).map(String);
  if (hits.length) {
    updates.push(`UPDATE ai_explanations SET text_json = '${JSON.stringify({ rejected: true, validation: { ok: false, problems: hits.map((h) => `prohibited language: ${h}`) } }).replace(/'/g, "''")}' WHERE id = '${r.id}';`);
    console.log(`REJECT ${r.id}: ${hits.join(", ")}  ->  "${t.summary.slice(0, 110)}..."`);
  }
}
if (updates.length) {
  writeFileSync(".wrangler/ai-recheck.sql", updates.join("\n") + "\n");
  execSync("npx wrangler d1 execute DB --local --file .wrangler/ai-recheck.sql", { stdio: "ignore" });
}
console.log(`Checked ${checked} accepted summaries; newly rejected ${updates.length}.`);
