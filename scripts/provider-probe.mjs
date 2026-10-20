// Admin-only provider probe through the REAL metered gateway (every call is counted and logged).
// Usage: node scripts/provider-probe.mjs --admin-email a@x --admin-password ... [--job '{"kind":"status","priority":"reserve"}'] [--url http://127.0.0.1:5173]
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://127.0.0.1:5173");
const H = { "content-type": "application/json", "x-requested-with": "fip" };
const login = await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ email: arg("admin-email"), password: arg("admin-password") }) });
if (!login.ok) throw new Error(`login failed: ${(await login.json()).error?.message}`);
const cookie = login.headers.get("set-cookie").split(";")[0];
const jobs = (arg("jobs") ? JSON.parse(arg("jobs")) : [JSON.parse(arg("job", '{"kind":"status","priority":"reserve"}'))]);
for (const job of jobs) {
  const r = await fetch(`${url}/api/v1/admin/ingest`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify(job) });
  const b = await r.json();
  console.log(`\n== ${JSON.stringify(job)} -> HTTP ${r.status}`);
  console.log(JSON.stringify(b.ok ? b.data : b.error, null, 2));
}
const usage = await (await fetch(`${url}/api/v1/admin/usage`, { headers: { cookie } })).json();
const u = usage.data;
console.log(`\nBudget today: ${u.used_today} used / ${u.operational_budget} operational (hard cap ${u.hard_cap}); provider reports remaining: ${u.provider_reported.remaining ?? "n/a"}`);
