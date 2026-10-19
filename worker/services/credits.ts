/**
 * Credits and report entitlements. Authoritative state lives ONLY in D1.
 *
 * unlockReport() is a single D1 batch (executed as one SQL transaction):
 *   1. INSERT OR IGNORE the entitlement row - only if balance >= 1 (UNIQUE(user, fixture, scope)
 *      makes a second entitlement for the same fixture impossible).
 *   2. UPDATE wallet: balance - 1 - only if THIS batch's entitlement row exists (matched by new id).
 *   3. INSERT the spend ledger row - same condition. idempotency_key = unlock:<user>:<fixture>:<scope>
 *      is UNIQUE, so a fixture can never be charged twice for a user even across code paths.
 *   4. Postcondition guard: entitlement and ledger rows must exist together, otherwise an error is
 *      raised and the whole batch rolls back. CHECK(balance >= 0) is a final safety net.
 * Concurrent requests are serialised by D1's single-writer model; tests exercise this against real
 * local D1 (miniflare) - see tests/integration/credits.test.ts.
 */
import type { Env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { nowIso } from "../lib/time.ts";

export const ENTITLEMENT_SCOPE = "FIXTURE_ALL_VERSIONS";

export interface UnlockResult {
  unlocked: true;
  charged: boolean;
  balance: number;
  unlock_id: string;
  free_reason?: "public_sample" | "already_unlocked";
}

export async function getBalance(env: Env, userId: string): Promise<number> {
  const w = await env.DB.prepare("SELECT balance FROM wallets WHERE user_id = ?").bind(userId).first<{ balance: number }>();
  return w?.balance ?? 0;
}

export async function hasEntitlement(env: Env, userId: string, fixtureId: string): Promise<boolean> {
  const r = await env.DB.prepare("SELECT 1 AS x FROM report_unlocks WHERE user_id = ? AND fixture_id = ? AND entitlement_scope = ?")
    .bind(userId, fixtureId, ENTITLEMENT_SCOPE)
    .first();
  return !!r;
}

export async function unlockReport(env: Env, userId: string, fixtureId: string, clientKey: string | null): Promise<UnlockResult> {
  const fx = await env.DB.prepare(
    `SELECT f.id, f.is_public_sample, (SELECT COUNT(*) FROM match_reports r WHERE r.fixture_id = f.id) AS reports
       FROM fixtures f WHERE f.id = ?`,
  )
    .bind(fixtureId)
    .first<{ id: string; is_public_sample: number; reports: number }>();
  if (!fx) throw new ApiError(404, "NOT_FOUND", "Fixture not found.");
  if (!fx.reports) {
    throw new ApiError(409, "REPORT_UNAVAILABLE", "No report has been prepared for this fixture yet, so it cannot be unlocked. No credit was used.");
  }

  const existing = await env.DB.prepare("SELECT id FROM report_unlocks WHERE user_id = ? AND fixture_id = ? AND entitlement_scope = ?")
    .bind(userId, fixtureId, ENTITLEMENT_SCOPE)
    .first<{ id: string }>();
  if (existing) return { unlocked: true, charged: false, balance: await getBalance(env, userId), unlock_id: existing.id, free_reason: "already_unlocked" };
  if (fx.is_public_sample) return { unlocked: true, charged: false, balance: await getBalance(env, userId), unlock_id: "public_sample", free_reason: "public_sample" };

  const unlockId = newId("unl");
  const ledgerId = newId("led");
  const now = nowIso();
  const idem = `unlock:${userId}:${fixtureId}:${ENTITLEMENT_SCOPE}`;
  const db = env.DB;
  try {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO report_unlocks (id, user_id, fixture_id, entitlement_scope, ledger_id, client_idempotency_key, unlocked_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT balance FROM wallets WHERE user_id = ?) >= 1`,
      ).bind(unlockId, userId, fixtureId, ENTITLEMENT_SCOPE, ledgerId, clientKey, now, userId),
      db.prepare(
        `UPDATE wallets SET balance = balance - 1, version = version + 1, updated_at = ?
          WHERE user_id = ? AND EXISTS (SELECT 1 FROM report_unlocks WHERE id = ?)`,
      ).bind(now, userId, unlockId),
      db.prepare(
        `INSERT INTO credit_ledger (id, user_id, amount_signed, kind, reason, actor_id, idempotency_key, created_at, metadata_json)
         SELECT ?, ?, -1, 'spend', 'Full match report unlock', ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM report_unlocks WHERE id = ?)`,
      ).bind(ledgerId, userId, userId, idem, now, JSON.stringify({ fixture_id: fixtureId, unlock_id: unlockId, client_key: clientKey }), unlockId),
      db.prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM report_unlocks WHERE id = ?) = (SELECT COUNT(*) FROM credit_ledger WHERE id = ?)
                     THEN 1 ELSE json_extract('ledger-entitlement-mismatch', '$') END AS guard`,
      ).bind(unlockId, ledgerId),
    ]);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // A concurrent request for the SAME fixture won the race: UNIQUE constraints roll us back harmlessly.
    if (!msg.includes("UNIQUE") && !msg.includes("CHECK")) throw e;
  }

  const row = await db.prepare("SELECT id FROM report_unlocks WHERE user_id = ? AND fixture_id = ? AND entitlement_scope = ?")
    .bind(userId, fixtureId, ENTITLEMENT_SCOPE)
    .first<{ id: string }>();
  const balance = await getBalance(env, userId);
  if (!row) throw new ApiError(402, "INSUFFICIENT_CREDITS", "You have no report credits left. Nothing was charged.", { balance });
  const charged = row.id === unlockId;
  return { unlocked: true, charged, balance, unlock_id: row.id, ...(charged ? {} : { free_reason: "already_unlocked" as const }) };
}

/** Admin credit grant/adjustment: ledger + wallet in one batch; idempotent on the supplied key; audited. */
export async function adminGrant(env: Env, actorId: string, userId: string, amount: number, reason: string, idempotencyKey: string, requestId: string) {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100) {
    throw new ApiError(422, "VALIDATION_FAILED", "Amount must be a non-zero integer between -100 and 100.");
  }
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found.");
  const ledgerId = newId("led");
  const now = nowIso();
  const before = await getBalance(env, userId);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, user_id, amount_signed, kind, reason, actor_id, idempotency_key, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(ledgerId, userId, amount, amount > 0 ? "admin_grant" : "adjustment", reason, actorId, `admin_grant:${idempotencyKey}`, now, JSON.stringify({ request_id: requestId })),
      env.DB.prepare("INSERT INTO wallets (user_id, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(user_id) DO NOTHING").bind(userId, now),
      env.DB.prepare("UPDATE wallets SET balance = balance + ?, version = version + 1, updated_at = ? WHERE user_id = ?").bind(amount, now, userId),
      env.DB.prepare(
        "INSERT INTO admin_audit_log (id, actor_id, action, entity, entity_id, before_json, after_json, request_id, created_at) VALUES (?, ?, 'credits.grant', 'wallet', ?, ?, ?, ?, ?)",
      ).bind(newId("aud"), actorId, userId, JSON.stringify({ balance: before }), JSON.stringify({ delta: amount, reason }), requestId, now),
    ]);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("UNIQUE")) return { duplicate: true, balance: before };
    if (msg.includes("CHECK")) throw new ApiError(409, "CONFLICT", "Adjustment would make the balance negative.");
    throw e;
  }
  return { duplicate: false, balance: await getBalance(env, userId), ledger_id: ledgerId };
}
