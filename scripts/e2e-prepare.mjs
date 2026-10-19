// Fresh, isolated local D1 for E2E runs (never touches the normal dev database).
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";

const dir = process.env.FIP_PERSIST ?? ".wrangler/e2e-state";
rmSync(dir, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply DB --local --persist-to "${dir}"`, { stdio: "inherit" });
execSync("node scripts/seed-demo.mjs", { stdio: "inherit", env: { ...process.env, FIP_PERSIST: dir } });
