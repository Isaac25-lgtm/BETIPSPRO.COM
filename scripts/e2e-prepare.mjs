// Fresh, isolated local D1 for E2E runs (never touches the normal dev database).
import { rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const dir = process.env.FIP_PERSIST ?? ".wrangler/e2e-state";
rmSync(dir, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply DB --local --persist-to "${dir}"`, { stdio: "inherit" });
execSync("node scripts/seed-demo.mjs", { stdio: "inherit", env: { ...process.env, FIP_PERSIST: dir } });
// The walkthrough exercises the credit unlock flow, so the E2E database runs with open access off.
writeFileSync(`${dir}/access-off.sql`, `UPDATE app_config SET value_json = '{"open":false}' WHERE key = 'access';
`);
execSync(`npx wrangler d1 execute DB --local --persist-to "${dir}" --file "${dir}/access-off.sql"`, { stdio: "inherit" });
