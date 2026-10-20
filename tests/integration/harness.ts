/**
 * Integration harness: the real Hono app + REAL local D1 (miniflare via wrangler getPlatformProxy),
 * each test file in its own isolated, throwaway database directory.
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { resetAccessCache } from "../../worker/services/access.ts";
import { app } from "../../worker/index.ts";
import type { Env } from "../../worker/env.ts";
import { artifactRequests, importSection, ImportRequestSchema, shiftArtifact, type Artifact } from "../../worker/services/importer.ts";

export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let inTrigger = false;
  for (const raw of sql.split(/\r?\n/)) {
    const line = raw.replace(/--.*$/, "").trimEnd();
    if (!line.trim()) continue;
    buf.push(line);
    if (/^\s*CREATE TRIGGER/i.test(line)) inTrigger = true;
    if (inTrigger ? /END;\s*$/i.test(line) : /;\s*$/.test(line)) {
      out.push(buf.join("\n"));
      buf = [];
      inTrigger = false;
    }
  }
  return out;
}

export interface TestCtx {
  env: Env;
  dispose: () => Promise<void>;
  call: (path: string, init?: RequestInit & { cookie?: string; json?: unknown }) => Promise<{ status: number; body: any; headers: Headers; setCookie: string | null }>;
}

let counter = 0;
export async function createTestEnv(opts: { seed?: boolean; vars?: Partial<Env>; openAccess?: boolean } = {}): Promise<TestCtx> {
  const dir = `.wrangler/test-state/${process.pid}-${Date.now()}-${counter++}`;
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc", persist: { path: dir } });
  // Tests never use the developer's real provider key from .dev.vars; they opt in explicitly via opts.vars.
  const env = { ...proxy.env, API_FOOTBALL_KEY: undefined, SPORTS_PROVIDER: "demo", ...opts.vars } as Env;
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) {
    const stmts = splitSql(readFileSync(`migrations/${f}`, "utf8"));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50).map((s) => env.DB.prepare(s)));
  }
  if (opts.seed) await seedDemo(env);
  // Most tests exercise the credit/lock flow, so open access (testing-phase default) is off unless asked for.
  await env.DB.prepare("UPDATE app_config SET value_json = ? WHERE key = 'access'").bind(JSON.stringify({ open: !!opts.openAccess })).run();
  resetAccessCache();
  const call: TestCtx["call"] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    let reqBody = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      reqBody = JSON.stringify(init.json);
    }
    const method = (init.method ?? (init.json !== undefined ? "POST" : "GET")).toUpperCase();
    if (method !== "GET" && !headers.has("x-requested-with")) headers.set("x-requested-with", "fip");
    const res = await app.fetch(new Request(`http://localhost${path}`, { ...init, method, headers, body: reqBody }), env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, body, headers: res.headers, setCookie: res.headers.get("set-cookie") };
  };
  return {
    env,
    call,
    dispose: async () => {
      await proxy.dispose();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* windows file locks: ignore */
      }
    },
  };
}

export async function seedDemo(env: Env) {
  let artifact = JSON.parse(readFileSync("fixtures/demo/demo-artifact.json", "utf8")) as Artifact;
  const anchorDay = Date.parse(artifact.anchor_utc.slice(0, 10) + "T00:00:00Z");
  const eat = new Date(Date.now() + 3 * 3600_000);
  artifact = shiftArtifact(artifact, Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - anchorDay);
  for (const raw of artifactRequests(artifact)) await importSection(env.DB, ImportRequestSchema.parse(raw), { actorId: null, now: new Date().toISOString() });
  const s = await env.DB.prepare("SELECT f.id FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id ORDER BY f.starts_at_utc, f.id LIMIT 1").first<{ id: string }>();
  await env.DB.prepare("UPDATE fixtures SET is_public_sample = 1 WHERE id = ?").bind(s!.id).run();
}

export const cookieOf = (setCookie: string | null) => (setCookie ? setCookie.split(";")[0] : "");

/** Bootstrap admin + n testers. Returns cookies. */
export async function setupUsers(t: TestCtx, n: number) {
  const pw = "AdminPassw0rd!x";
  const boot = await t.call("/api/v1/setup/admin", { json: { token: t.env.ADMIN_BOOTSTRAP_TOKEN, email: "admin@example.test", display_name: "Admin", password: pw } });
  if (boot.status !== 201) throw new Error(`bootstrap failed ${JSON.stringify(boot.body)}`);
  const login = await t.call("/api/v1/auth/login", { json: { email: "admin@example.test", password: pw } });
  const admin = cookieOf(login.setCookie);
  const testers: Array<{ email: string; cookie: string }> = [];
  for (let i = 1; i <= n; i++) {
    const email = `tester${i}@example.test`;
    const inv = await t.call("/api/v1/admin/invitations", { cookie: admin, json: { email } });
    if (inv.status !== 201) throw new Error(`invite failed ${JSON.stringify(inv.body)}`);
    const red = await t.call("/api/v1/auth/redeem-invite", { json: { code: inv.body.data.code, email, display_name: `Tester ${i}`, password: "TesterPass123", age_confirmed: true, privacy_consent: true } });
    if (red.status !== 201) throw new Error(`redeem failed ${JSON.stringify(red.body)}`);
    testers.push({ email, cookie: cookieOf(red.setCookie) });
  }
  return { admin, testers };
}
