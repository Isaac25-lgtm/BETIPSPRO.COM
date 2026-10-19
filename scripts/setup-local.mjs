// One-time local setup.
//   1. Creates .dev.vars with random secrets if missing (never overwrites).
//   2. Applies D1 migrations and seeds SYNTHETIC demo data if the local DB is empty.
//   3. If a dev server is running, bootstraps the administrator (one-time) and prints the credentials ONCE.
// Usage: npm run setup:local -- [--admin-email you@example.com] [--url http://localhost:5173]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5173");
const adminEmail = arg("admin-email", "admin@localhost.test");

if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    [
      `ADMIN_BOOTSTRAP_TOKEN=${randomBytes(24).toString("base64url")}`,
      `SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
      "API_FOOTBALL_KEY=",
      "TURNSTILE_SECRET_KEY=",
      "",
    ].join("\n"),
  );
  console.log("Created .dev.vars with random local secrets (gitignored).");
} else console.log(".dev.vars exists - left unchanged.");

execSync("npx wrangler d1 migrations apply DB --local", { stdio: "inherit" });
const count = execSync('npx wrangler d1 execute DB --local --json --command "SELECT COUNT(*) AS n FROM fixtures"').toString();
const n = JSON.parse(count)[0]?.results?.[0]?.n ?? 0;
if (n === 0) execSync("node scripts/seed-demo.mjs", { stdio: "inherit" });
else console.log(`Local DB already has ${n} fixtures - not reseeding (use npm run db:reset to start over).`);

const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
try {
  const health = await fetch(`${url}/api/v1/health`);
  if (!health.ok) throw new Error();
} catch {
  console.log(`\nNo dev server at ${url}. Start it with "npm run dev", then re-run this script to create the admin.`);
  process.exit(0);
}
const password = randomBytes(12).toString("base64url") + "9a";
const res = await fetch(`${url}/api/v1/setup/admin`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-requested-with": "fip" },
  body: JSON.stringify({ token: vars.ADMIN_BOOTSTRAP_TOKEN, email: adminEmail, display_name: "Administrator", password }),
});
const body = await res.json();
if (res.status === 201) {
  console.log("\nAdministrator created. SAVE THESE NOW - the password is not stored anywhere else:");
  console.log(`  email:    ${adminEmail}\n  password: ${password}\n  login:    ${url}/login`);
} else console.log(`\nAdmin bootstrap skipped: ${body.error?.message}`);
