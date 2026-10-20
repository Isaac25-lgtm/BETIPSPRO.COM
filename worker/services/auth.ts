/**
 * Invite-only authentication for the beta.
 *
 *  - Admin issues an invite bound to an email; the one-time code is shown ONCE and stored hashed.
 *  - Tester redeems code + matching email + password (PBKDF2-SHA256) -> account, wallet, beta credits.
 *  - Sessions: 256-bit random token in an HttpOnly cookie; only SHA-256(token + pepper) is stored.
 *  - Login throttling per email and per IP (hashed buckets in D1).
 * See docs/decisions.md (D-007) for why this is used instead of a third-party auth library for the beta,
 * and how an OAuth provider can be added later via auth_accounts(provider, provider_subject).
 */
import type { Env, SessionUser } from "../env.ts";
import { num } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { hashPassword, inviteCode, newId, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "../lib/crypto.ts";
import { nowIso } from "../lib/time.ts";

export const SESSION_COOKIE = "fip_session";
export const SESSION_TTL_DAYS = 14;
const INVITE_TTL_DAYS = 14;

const pepper = (env: Env) => env.SESSION_SECRET ?? "dev-only-pepper-set-SESSION_SECRET";

export async function hashSecret(env: Env, value: string): Promise<string> {
  return sha256Hex(`${pepper(env)}:${value}`);
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

// ------------------------------------------------------------------ rate limiting

export async function checkRateLimit(env: Env, bucket: string, max: number, windowMinutes: number): Promise<void> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE bucket = ? AND created_at > ?").bind(bucket, since).first<{ n: number }>();
  if ((row?.n ?? 0) >= max) throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
}

export async function recordAttempt(env: Env, bucket: string): Promise<void> {
  await env.DB.prepare("INSERT INTO auth_attempts (bucket, created_at) VALUES (?, ?)").bind(bucket, nowIso()).run();
}

// ------------------------------------------------------------------ sessions

export async function createSession(env: Env, userId: string, userAgent: string | null): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const id = await hashSecret(env, `session:${token}`);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(id, userId, nowIso(), expiresAt, userAgent?.slice(0, 200) ?? null)
    .run();
  return { token, expiresAt };
}

export async function sessionUser(env: Env, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = await hashSecret(env, `session:${token}`);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.age_confirmed_at, u.privacy_consent_at, s.id AS session_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
  )
    .bind(id, nowIso())
    .first<SessionUser>();
  return row ?? null;
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(nowIso(), sessionId).run();
}

export async function revokeAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(nowIso(), userId).run();
}

export function sessionCookie(token: string, secure: boolean, maxAgeSec = SESSION_TTL_DAYS * 86400): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

// ------------------------------------------------------------------ login

export async function login(env: Env, email: string, password: string, ipHash: string): Promise<string> {
  const emailKey = await hashSecret(env, `email:${email.toLowerCase()}`);
  await checkRateLimit(env, `login:${emailKey}`, 8, 15);
  await checkRateLimit(env, `ip:${ipHash}`, 40, 15);
  const acct = await env.DB.prepare(
    `SELECT a.secret_hash, u.id, u.status FROM auth_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.provider = 'password' AND a.provider_subject = ? COLLATE NOCASE`,
  )
    .bind(email.toLowerCase())
    .first<{ secret_hash: string; id: string; status: string }>();
  // Always run a hash comparison to reduce user-enumeration timing differences.
  const okPw = await verifyPassword(password, acct?.secret_hash ?? "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!acct || !okPw || acct.status !== "active") {
    await recordAttempt(env, `login:${emailKey}`);
    await recordAttempt(env, `ip:${ipHash}`);
    throw new ApiError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
  }
  return acct.id;
}

// ------------------------------------------------------------------ admin bootstrap

export async function bootstrapAdmin(env: Env, token: string, email: string, displayName: string, password: string): Promise<string> {
  if (!env.ADMIN_BOOTSTRAP_TOKEN || env.ADMIN_BOOTSTRAP_TOKEN.length < 16) {
    throw new ApiError(403, "FORBIDDEN", "Admin bootstrap is disabled (ADMIN_BOOTSTRAP_TOKEN not configured).");
  }
  if (!timingSafeEqual(token, env.ADMIN_BOOTSTRAP_TOKEN)) throw new ApiError(403, "FORBIDDEN", "Invalid bootstrap token.");
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) throw new ApiError(409, "CONFLICT", "An administrator already exists; bootstrap is one-time only.");
  const pwErr = validatePassword(password);
  if (pwErr) throw new ApiError(422, "VALIDATION_FAILED", pwErr);
  const userId = newId("usr");
  const now = nowIso();
  const hash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, display_name, role, status, age_confirmed_at, privacy_consent_at, created_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?, ?)")
      .bind(userId, email.toLowerCase(), displayName, now, now, now),
    env.DB.prepare("INSERT INTO auth_accounts (id, user_id, provider, provider_subject, secret_hash, created_at) VALUES (?, ?, 'password', ?, ?, ?)")
      .bind(newId("acc"), userId, email.toLowerCase(), hash, now),
    env.DB.prepare("INSERT INTO wallets (user_id, balance, updated_at) VALUES (?, 0, ?)").bind(userId, now),
    env.DB.prepare("INSERT INTO admin_audit_log (id, actor_id, action, entity, entity_id, after_json, created_at) VALUES (?, ?, 'admin.bootstrap', 'user', ?, ?, ?)")
      .bind(newId("aud"), userId, userId, JSON.stringify({ email: email.toLowerCase() }), now),
  ]);
  return userId;
}

// ------------------------------------------------------------------ invites

export async function createInvite(env: Env, adminId: string, email: string): Promise<{ id: string; code: string; expires_at: string }> {
  const max = num(env.MAX_BETA_USERS, 5);
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'tester' AND status != 'deleted') AS testers,
            (SELECT COUNT(*) FROM beta_invites WHERE status = 'issued' AND expires_at > ?) AS pending,
            (SELECT COUNT(*) FROM beta_invites WHERE status = 'issued' AND expires_at > ? AND email = ? COLLATE NOCASE) AS same_email,
            (SELECT COUNT(*) FROM users WHERE email = ? COLLATE NOCASE) AS existing`,
  )
    .bind(nowIso(), nowIso(), email, email)
    .first<{ testers: number; pending: number; same_email: number; existing: number }>();
  if (counts!.existing > 0) throw new ApiError(409, "CONFLICT", "A user with this email already exists.");
  if (counts!.same_email > 0) throw new ApiError(409, "CONFLICT", "An active invite for this email already exists. Revoke it first to reissue.");
  if (counts!.testers + counts!.pending >= max) {
    throw new ApiError(409, "CONFLICT", `Beta is limited to ${max} testers (${counts!.testers} active, ${counts!.pending} pending invites).`);
  }
  const code = inviteCode();
  const id = newId("inv");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const now = nowIso();
  const ins = await env.DB.prepare(
    `INSERT INTO beta_invites (id, email, code_hash, status, issued_by, issued_at, expires_at, max_uses)
       SELECT ?1, ?2, ?3, 'issued', ?4, ?5, ?6, 1
        WHERE (SELECT COUNT(*) FROM users WHERE role = 'tester' AND status != 'deleted')
            + (SELECT COUNT(*) FROM beta_invites WHERE status = 'issued' AND expires_at > ?5) < ?7`,
  ).bind(id, email.toLowerCase(), await hashSecret(env, `invite:${code}`), adminId, now, expires, max).run();
  if ((ins.meta.changes ?? 0) !== 1) throw new ApiError(409, "CONFLICT", `Beta is limited to ${max} testers.`);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO admin_audit_log (id, actor_id, action, entity, entity_id, after_json, created_at) VALUES (?, ?, 'invite.create', 'beta_invite', ?, ?, ?)")
      .bind(newId("aud"), adminId, id, JSON.stringify({ email: email.toLowerCase(), expires_at: expires }), nowIso()),
  ]);
  return { id, code, expires_at: expires };
}

/**
 * Redeem an invite. All writes happen in ONE D1 batch (a transaction): user, credentials, wallet,
 * invite consumption and the idempotent beta credit grant. If the invite was consumed concurrently,
 * the conditional UPDATE matches nothing and the trailing guard aborts the whole batch.
 */
export async function redeemInvite(
  env: Env,
  input: { code: string; email: string; displayName: string; password: string; ageConfirmed: boolean; privacyConsent: boolean },
  ipHash: string,
): Promise<string> {
  await checkRateLimit(env, `invite-ip:${ipHash}`, 15, 30);
  if (!input.ageConfirmed) throw new ApiError(422, "VALIDATION_FAILED", "You must confirm you are 18 or older.");
  if (!input.privacyConsent) throw new ApiError(422, "VALIDATION_FAILED", "You must accept the privacy notice and beta terms.");
  const pwErr = validatePassword(input.password);
  if (pwErr) throw new ApiError(422, "VALIDATION_FAILED", pwErr);
  const codeHash = await hashSecret(env, `invite:${input.code.trim().toUpperCase()}`);
  const inv = await env.DB.prepare("SELECT id, email, status, expires_at FROM beta_invites WHERE code_hash = ?").bind(codeHash).first<{
    id: string; email: string; status: string; expires_at: string;
  }>();
  if (!inv || inv.email.toLowerCase() !== input.email.toLowerCase()) {
    await recordAttempt(env, `invite-ip:${ipHash}`);
    throw new ApiError(400, "BAD_REQUEST", "Invite code and email do not match an active invitation.");
  }
  if (inv.status !== "issued") throw new ApiError(409, "CONFLICT", "This invitation has already been used or revoked.");
  if (inv.expires_at <= nowIso()) throw new ApiError(409, "CONFLICT", "This invitation has expired. Ask the administrator for a new one.");

  const credits = num(env.BETA_INITIAL_CREDITS, 10);
  const userId = newId("usr");
  const ledgerId = newId("led");
  const now = nowIso();
  const hash = await hashPassword(input.password);
  const email = input.email.toLowerCase();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, display_name, role, status, age_confirmed_at, privacy_consent_at, created_at) VALUES (?, ?, ?, 'tester', 'active', ?, ?, ?)")
        .bind(userId, email, input.displayName.trim().slice(0, 60), now, now, now),
      env.DB.prepare("INSERT INTO auth_accounts (id, user_id, provider, provider_subject, secret_hash, created_at) VALUES (?, ?, 'password', ?, ?, ?)")
        .bind(newId("acc"), userId, email, hash, now),
      env.DB.prepare("UPDATE beta_invites SET status = 'used', used_at = ?, used_by = ? WHERE id = ? AND status = 'issued'").bind(now, userId, inv.id),
      // Abort the whole batch (rollback, including the user row) if the invite was not consumed by THIS batch.
      env.DB.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('invite-already-consumed', '$') END"),
      env.DB.prepare("INSERT INTO wallets (user_id, balance, updated_at, version) VALUES (?, ?, ?, 1)").bind(userId, credits, now),
      env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount_signed, kind, reason, actor_id, idempotency_key, created_at, metadata_json) VALUES (?, ?, ?, 'beta_grant', 'Beta tester welcome credits', NULL, ?, ?, ?)")
        .bind(ledgerId, userId, credits, `beta_grant:${userId}`, now, JSON.stringify({ invite_id: inv.id })),
      env.DB.prepare("INSERT INTO admin_audit_log (id, actor_id, action, entity, entity_id, after_json, created_at) VALUES (?, ?, 'invite.redeem', 'user', ?, ?, ?)")
        .bind(newId("aud"), userId, userId, JSON.stringify({ invite_id: inv.id, credits }), now),
    ]);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("malformed JSON") || msg.includes("json")) {
      throw new ApiError(409, "CONFLICT", "This invitation has already been used, or an account with this email exists.");
    }
    throw e;
  }
  return userId;
}
