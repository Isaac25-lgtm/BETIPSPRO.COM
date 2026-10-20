import type { Env } from "../env.ts";
import { nowIso } from "../lib/time.ts";
import { clearPublicCache } from "../middleware/public-cache.ts";

/**
 * Open access (testing phase, owner decision D-026): when on, every full report and evidence page is readable by
 * anyone, signed in or not, and no credit is needed. Credits, unlocks and the ledger keep working underneath, so
 * switching it off restores the paid flow exactly. Stored in app_config so an admin can flip it without a deploy.
 */
let cache: { at: number; value: boolean } | null = null;

export async function openAccess(env: Env): Promise<boolean> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const row = await env.DB.prepare("SELECT value_json FROM app_config WHERE key = 'access'").first<{ value_json: string }>();
  let value = false;
  try {
    value = !!(row && JSON.parse(row.value_json).open === true);
  } catch {
    value = false;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setOpenAccess(env: Env, open: boolean, by: string | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO app_config (key, value_json, updated_at, updated_by) VALUES ('access', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).bind(JSON.stringify({ open }), nowIso(), by).run();
  cache = null;
  clearPublicCache();
}

/** Test/support hook: forget the cached value (e.g. after a direct DB write). */
export function resetAccessCache(): void {
  cache = null;
}
