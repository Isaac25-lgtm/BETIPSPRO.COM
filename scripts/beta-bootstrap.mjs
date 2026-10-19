// Create beta invitations through the real admin API (audited, max 5 testers enforced server-side).
// Usage: npm run beta:bootstrap -- --admin-email a@x --admin-password ... --invite t1@x,t2@y [--url http://localhost:5173]
// Codes are printed ONCE; only their hashes are stored. Send each privately to the matching tester.
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5173");
const emails = (arg("invite", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!emails.length || !arg("admin-email") || !arg("admin-password")) {
  console.error("Usage: npm run beta:bootstrap -- --admin-email <email> --admin-password <pw> --invite a@x,b@y");
  process.exit(1);
}
const h = { "content-type": "application/json", "x-requested-with": "fip" };
const login = await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: h, body: JSON.stringify({ email: arg("admin-email"), password: arg("admin-password") }) });
if (!login.ok) {
  console.error("Admin login failed:", (await login.json()).error?.message);
  process.exit(1);
}
const cookie = login.headers.get("set-cookie").split(";")[0];
for (const email of emails) {
  const r = await fetch(`${url}/api/v1/admin/invitations`, { method: "POST", headers: { ...h, cookie }, body: JSON.stringify({ email }) });
  const b = await r.json();
  if (r.ok) console.log(`${email}\tcode ${b.data.code}\texpires ${b.data.expires_at}\t${url}/join?email=${encodeURIComponent(email)}`);
  else console.log(`${email}\tFAILED: ${b.error.message}`);
}
