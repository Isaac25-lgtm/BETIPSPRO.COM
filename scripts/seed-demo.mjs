// Seed the LOCAL D1 database with the SYNTHETIC demo artifact.
// Re-anchors synthetic timestamps so "today's" fixtures fall on the current date.
// Uses wrangler's getPlatformProxy (real local D1/miniflare) and the SAME importer the admin API uses.
// Usage: node scripts/seed-demo.mjs [path/to/artifact.json]
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { artifactRequests, importSection, ImportRequestSchema, shiftArtifact } from "../worker/services/importer.ts";

const path = process.argv[2] ?? "fixtures/demo/demo-artifact.json";
let artifact = JSON.parse(readFileSync(path, "utf8"));
if (artifact.data_mode !== "SIMULATED_DEMO") {
  console.error("seed-demo only imports SIMULATED_DEMO artifacts. Use the admin import for real data.");
  process.exit(1);
}
const anchorDay = Date.parse(artifact.anchor_utc.slice(0, 10) + "T00:00:00Z");
// Anchor on the calendar day in Uganda (EAT, UTC+3), which is how the product presents dates.
const eatNow = new Date(Date.now() + 3 * 3600_000);
const todayDay = Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), eatNow.getUTCDate());
const shift = todayDay - anchorDay;
artifact = shiftArtifact(artifact, shift);
// The run id embeds the anchor date; keep it unique per re-anchor.
const stamp = new Date(todayDay).toISOString().slice(0, 10).replace(/-/g, "");
artifact.model_run.id = `run:${artifact.model_run.model_version}:demo-${stamp}`;
artifact.backtest_run.id = `${artifact.model_run.id}:backtest`;

const { env, dispose } = await getPlatformProxy({ configPath: "wrangler.jsonc", ...(process.env.FIP_PERSIST ? { persist: { path: `${process.env.FIP_PERSIST}/v3` } } : {}) });
const ctx = { actorId: null, now: new Date().toISOString() };
let total = 0;
const t0 = Date.now();
for (const raw of artifactRequests(artifact)) {
  const req = ImportRequestSchema.parse(raw);
  const res = await importSection(env.DB, req, ctx);
  total += res.written;
  if (res.rejected.length) console.warn(`  ${res.section}: ${res.rejected.length} rejected`, res.rejected.slice(0, 3));
}
// Mark one synthetic fixture as the free public sample report.
const sample = await env.DB.prepare(
  "SELECT f.id FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id WHERE f.is_synthetic = 1 AND f.status = 'NS' ORDER BY f.starts_at_utc, f.id LIMIT 1",
).first();
await env.DB.prepare("UPDATE fixtures SET is_public_sample = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE is_synthetic = 1").bind(sample?.id ?? "").run();
console.log(`Seeded SYNTHETIC demo data: ${total} rows written in ${((Date.now() - t0) / 1000).toFixed(1)}s (shifted ${Math.round(shift / 86400000)} days). Public sample fixture: ${sample?.id}`);
await dispose();
