// Import a model-pipeline artifact through the AUTHENTICATED admin API, section by section.
// Usage: node scripts/import-artifact.mjs --file model-pipeline/data/exports/artifact.json \
//          --admin-email a@x --admin-password ... [--url http://localhost:5173]
// SIMULATED_DEMO artifacts should use `npm run db:seed` instead (it re-anchors timestamps).
import { readFileSync } from "node:fs";
import { artifactRequests } from "../worker/services/importer.ts";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5173");
const file = arg("file");
if (!file || !arg("admin-email") || !arg("admin-password")) {
  console.error("Usage: node scripts/import-artifact.mjs --file <artifact.json> --admin-email <email> --admin-password <pw>");
  process.exit(1);
}
const artifact = JSON.parse(readFileSync(file, "utf8"));
const H = { "content-type": "application/json", "x-requested-with": "fip" };
const login = await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ email: arg("admin-email"), password: arg("admin-password") }) });
if (!login.ok) throw new Error(`login failed: ${(await login.json()).error?.message}`);
const cookie = login.headers.get("set-cookie").split(";")[0];
let written = 0;
let rejected = 0;
for (const req of artifactRequests(artifact, 300)) {
  const r = await fetch(`${url}/api/v1/admin/forecasts/import`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify(req) });
  const b = await r.json();
  if (!r.ok) throw new Error(`${req.section}: ${b.error.code} ${b.error.message} ${JSON.stringify(b.error.details ?? "").slice(0, 400)}`);
  written += b.data.written;
  rejected += b.data.rejected.length;
  if (b.data.rejected.length) console.warn(`${req.section}: ${b.data.rejected.length} rejected, e.g.`, b.data.rejected.slice(0, 2));
}
console.log(`Imported ${artifact.data_mode} run ${artifact.model_run.id}: ${written} rows written, ${rejected} rejected.`);
