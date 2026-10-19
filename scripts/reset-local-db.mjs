// Deletes the LOCAL wrangler D1 state only (never touches remote databases).
import { rmSync, existsSync } from "node:fs";
const dir = ".wrangler/state/v3/d1";
if (existsSync(dir)) {
  rmSync(dir, { recursive: true, force: true });
  console.log("Removed local D1 state:", dir);
} else console.log("No local D1 state to remove.");
