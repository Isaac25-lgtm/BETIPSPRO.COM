// Local representative load test (section 14 matrix).
// Runs the BUILT Worker under `wrangler dev` (workerd + local D1) on an isolated state directory.
// IMPORTANT: this measures a single local machine, not Cloudflare's edge. It is evidence about
// application/D1 behaviour under concurrency, not proof of production capacity.
//
// Usage: npm run build && node tests/performance/load-test.mjs [--levels 1,5,25,100,500] [--seconds 20]
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const LEVELS = arg("levels", "1,5,25,100,500").split(",").map(Number);
const SECONDS = Number(arg("seconds", "20"));
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE = ".wrangler/load-state";
const H = { "content-type": "application/json", "x-requested-with": "fip" };

// ---------------------------------------------------------------- isolated environment
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply DB --local --persist-to "${STATE}"`, { stdio: "ignore" });
execSync("node scripts/seed-demo.mjs", { stdio: "ignore", env: { ...process.env, FIP_PERSIST: STATE } });
const server = spawn("npx", ["wrangler", "dev", "--config", "dist/football_research_platform/wrangler.json", "--port", String(PORT), "--persist-to", STATE, "--ip", "127.0.0.1"], { shell: true, stdio: "ignore" });
const stop = () => { try { process.platform === "win32" ? execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" }) : server.kill("SIGTERM"); } catch { /* ignore */ } };
process.on("exit", stop);
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const post = (p, body, cookie) => fetch(BASE + p, { method: "POST", headers: { ...H, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
await post("/api/v1/setup/admin", { token: vars.ADMIN_BOOTSTRAP_TOKEN, email: "load-admin@example.test", display_name: "Load Admin", password: "LoadAdminPass1" });
const adminCookie = (await post("/api/v1/auth/login", { email: "load-admin@example.test", password: "LoadAdminPass1" })).headers.get("set-cookie").split(";")[0];
const testers = [];
for (let i = 1; i <= 5; i++) {
  const email = `load${i}@example.test`;
  const code = (await (await post("/api/v1/admin/invitations", { email }, adminCookie)).json()).data.code;
  const r = await post("/api/v1/auth/redeem-invite", { code, email, display_name: `Load ${i}`, password: "LoadTester123", age_confirmed: true, privacy_consent: true });
  testers.push({ email, cookie: r.headers.get("set-cookie").split(";")[0] });
}
const fixtures = (await (await fetch(`${BASE}/api/v1/fixtures?status=all&page_size=100`)).json()).data.items;
const allUpcoming = [];
for (let d = 0; d < 7; d++) {
  const day = new Date(Date.now() + 3 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10);
  allUpcoming.push(...(await (await fetch(`${BASE}/api/v1/fixtures?date=${day}&page_size=100`)).json()).data.items.filter((f) => f.report.available));
}
const sample = allUpcoming.find((f) => f.is_public_sample);
const markets = ["TOTAL_GOALS_UNDER_2_5_REGULATION", "BTTS_YES_REGULATION", "MATCH_RESULT_HOME_REGULATION", "TOTAL_CORNERS_OVER_9_5_REGULATION", "TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION"];
const providerCalls = async () => (await (await fetch(`${BASE}/api/v1/admin/usage`, { headers: { cookie: adminCookie } })).json()).data.used_today;

// ---------------------------------------------------------------- workload
const pick = (a) => a[Math.floor(Math.random() * a.length)];
async function timed(kind, url, init) {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + url, init);
    await r.arrayBuffer();
    return { kind, ms: performance.now() - t0, status: r.status };
  } catch {
    return { kind, ms: performance.now() - t0, status: 0 };
  }
}
async function action() {
  const x = Math.random();
  if (x < 0.65) {
    const out = [await timed("browse_fixtures", "/api/v1/fixtures")];
    out.push(await timed("browse_preview", `/api/v1/fixtures/${encodeURIComponent(pick(allUpcoming).id)}/preview`));
    return out;
  }
  if (x < 0.85) {
    const t = pick(testers);
    return [
      await timed("report_read", `/api/v1/fixtures/${encodeURIComponent(sample.id)}/report`, { headers: { cookie: t.cookie } }),
      await timed("market_evidence", `/api/v1/fixtures/${encodeURIComponent(sample.id)}/markets/${pick(markets)}/evidence`, { headers: { cookie: t.cookie } }),
    ];
  }
  if (x < 0.95) {
    const t = pick(testers);
    return [await timed("me_credits", "/api/v1/me/credits", { headers: { cookie: t.cookie } })];
  }
  // 5%: unlock attempts incl. deliberate duplicates; 402 (no credits left) is an expected outcome
  const t = pick(testers);
  const f = pick(allUpcoming.slice(0, 12));
  return [await timed("unlock", `/api/v1/fixtures/${encodeURIComponent(f.id)}/unlock`, { method: "POST", headers: { ...H, cookie: t.cookie } })];
}

const pctl = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);
const results = [];
for (const vus of LEVELS) {
  const before = await providerCalls();
  const samples = [];
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: vus }, async () => {
    while (Date.now() < end) {
      samples.push(...(await action()));
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 600)); // think time
    }
  }));
  const after = await providerCalls();
  const byKind = {};
  for (const s of samples) (byKind[s.kind] ??= []).push(s);
  const row = { vus, seconds: SECONDS, requests: samples.length, rps: +(samples.length / SECONDS).toFixed(1), provider_calls: after - before, kinds: {} };
  for (const [k, list] of Object.entries(byKind)) {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    const errors = list.filter((s) => s.status === 0 || s.status >= 500 || (s.status >= 400 && !(k === "unlock" && s.status === 402))).length;
    row.kinds[k] = { n: list.length, p50: +pctl(ms, 50).toFixed(0), p95: +pctl(ms, 95).toFixed(0), p99: +pctl(ms, 99).toFixed(0), error_rate: +(errors / list.length).toFixed(4) };
  }
  results.push(row);
  console.log(`\n=== ${vus} concurrent users, ${SECONDS}s: ${row.requests} requests (${row.rps}/s), provider calls: ${row.provider_calls}`);
  console.table(row.kinds);
}

// Ledger integrity after the storm
const ledger = await (await fetch(`${BASE}/api/v1/admin/credits/ledger`, { headers: { cookie: adminCookie } })).json();
const testersNow = await (await fetch(`${BASE}/api/v1/admin/testers`, { headers: { cookie: adminCookie } })).json();
const spendsByUser = {};
for (const l of ledger.data.items) if (l.kind === "spend") spendsByUser[l.email] = (spendsByUser[l.email] ?? 0) + 1;
const integrity = testersNow.data.items.filter((u) => u.role === "tester").map((u) => ({ email: u.email, balance: u.balance, spends: spendsByUser[u.email] ?? 0, unlocks: u.unlocks, consistent: u.balance + (spendsByUser[u.email] ?? 0) === 10 && u.unlocks === (spendsByUser[u.email] ?? 0) }));
console.log("\nCredit integrity after load:");
console.table(integrity);

mkdirSync("artifacts/load", { recursive: true });
const file = `artifacts/load/load-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ environment: "local wrangler dev (workerd) + local D1 on the developer machine; NOT Cloudflare edge", node: process.version, levels: results, credit_integrity: integrity }, null, 2));
console.log(`\nSaved ${file}`);
stop();
process.exit(0);
