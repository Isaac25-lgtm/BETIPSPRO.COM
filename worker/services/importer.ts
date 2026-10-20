/**
 * Artifact importer: validated, chunked, idempotent import of model-pipeline output into D1.
 *
 * Used by POST /api/v1/admin/forecasts/import (authenticated admin) and by the local
 * seed script (scripts/seed-demo.mjs via wrangler getPlatformProxy). Sections are imported
 * separately so each request stays small and within Worker CPU limits.
 *
 * Guarantees:
 *  - Forecast rows are INSERT OR IGNORE: an existing forecast is never rewritten
 *    (a DB trigger also blocks UPDATEs of probability/timestamps).
 *  - A pre-kickoff forecast must have data_as_of_at < kickoff AND generated_at < kickoff AND be stored by the
 *    server before kickoff (server clock, recorded as published_at; R-03). Late live rows are rejected.
 *  - Backtest rows are stored with is_pre_kickoff = 0 so they can never masquerade as
 *    published predictions.
 */
import { z } from "zod";
import { catalog, marketById } from "../../shared/markets.ts";

const iso = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "must be an ISO-8601 UTC timestamp")
  .refine((v) => { const t = Date.parse(v); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === v.slice(0, 19); }, "must be a real calendar date and time");
const ms = (v: string) => Date.parse(v);
const id = z.string().min(1).max(160);
const nint = z.number().int().nullable().optional();

export const DataModeSchema = z.enum(["SIMULATED_DEMO", "FREE_API", "PRODUCTION"]);

export const ModelRunSchema = z.object({
  id,
  model_version: z.string().max(60),
  pipeline_version: z.string().max(60),
  dataset_hash: z.string().max(100),
  generated_at: iso,
  data_as_of_at: iso,
  calibration_version: z.string().nullable(),
  market_catalog_version: z.string(),
  config: z.record(z.unknown()).default({}),
});

const CompetitionSchema = z.object({
  id, provider: z.string(), provider_id: z.string(), name: z.string().max(120), short_name: z.string().max(60),
  country: z.string().max(80), is_synthetic: z.number().int().min(0).max(1), current_season: z.string().nullable().optional(),
});
const TeamSchema = z.object({
  id, provider: z.string(), provider_id: z.string(), name: z.string().max(120), short_name: z.string().max(60),
  code: z.string().max(8).nullable().optional(), country: z.string().nullable().optional(),
  primary_color: z.string().max(9).nullable().optional(), secondary_color: z.string().max(9).nullable().optional(),
  competition_id: z.string().nullable().optional(), is_synthetic: z.number().int().min(0).max(1),
});
const RefereeSchema = z.object({ id, name: z.string().max(120), is_synthetic: z.number().int().min(0).max(1) });
const FixtureSchema = z.object({
  id, provider: z.string(), provider_id: z.string(), competition_id: id, season: z.string(), round: z.string().nullable().optional(),
  home_team_id: id, away_team_id: id, starts_at_utc: iso,
  status: z.enum(["NS", "TBD", "LIVE", "HT", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]),
  home_goals: nint, away_goals: nint, home_goals_ht: nint, away_goals_ht: nint,
  venue_name: z.string().nullable().optional(), venue_city: z.string().nullable().optional(),
  referee_id: z.string().nullable().optional(), is_synthetic: z.number().int().min(0).max(1),
});
const TeamStatSchema = z.object({
  fixture_id: id, team_id: id, corners: nint, yellow_cards: nint, red_cards: nint, shots: nint, shots_on_target: nint,
  possession_pct: z.number().nullable().optional(), xg: z.number().nullable().optional(),
});
const Uncertainty = z.object({ p05: z.number().min(0).max(1), p95: z.number().min(0).max(1), method: z.string(), note: z.string().optional(), unavailable: z.string().optional() })
  .partial()
  .refine((u) => u.p05 == null || u.p95 == null || u.p05 <= u.p95, "uncertainty range must satisfy p05 <= p95");
const ForecastSchema = z.object({
  fixture_id: id, market_id: id, probability: z.number().min(0).max(1).nullable(),
  status: z.enum(["VERIFIED", "PARTIAL", "INSUFFICIENT", "STALE", "SIMULATED_DEMO", "RESEARCH"]),
  quality_reason: z.string().nullable(), uncertainty: Uncertainty.default({}),
  data_as_of_at: iso.nullable().optional(), // per-competition training cut-off; falls back to the run's
});
const ArchiveSchema = ForecastSchema.omit({ uncertainty: true, data_as_of_at: true }).extend({ settled_outcome: z.number().int().min(0).max(1).nullable(), data_as_of_at: iso });
const DriverSchema = z.object({
  fixture_id: id, model_family: z.string(), metric: z.string().max(80), value: z.number().nullable(),
  value_json: z.unknown().optional(), sample_window: z.string().nullable().optional(), source_ref: z.string().nullable().optional(),
});
const ReportSchema = z.object({
  fixture_id: id, featured_market_id: z.string().nullable(),
  summary: z.record(z.unknown()), analysis: z.record(z.unknown()),
});
const EvaluationSchema = z.object({
  market_family: z.string(), competition_id: z.string().nullable(), sample_n: z.number().int().nonnegative(),
  brier: z.number().nullable(), log_loss: z.number().nullable(), baseline_brier: z.number().nullable(),
  baseline_log_loss: z.number().nullable(), calibration: z.array(z.record(z.unknown())),
});
const OddsSchema = z.object({
  fixture_id: id, market_id: id, bookmaker_name: z.string().max(80), odds_decimal: z.number().gt(1).lt(1000),
  provider_source: z.string().max(80),
});

const MAX_ROWS = 600;
const rows = <T extends z.ZodTypeAny>(s: T) => z.array(s).max(MAX_ROWS);

export const ImportRequestSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("run"), data_mode: DataModeSchema, model_run: ModelRunSchema, backtest_run: z.object({ id, description: z.string() }) }),
  z.object({ section: z.literal("reference"), competitions: rows(CompetitionSchema), teams: rows(TeamSchema), referees: rows(RefereeSchema) }),
  z.object({ section: z.literal("fixtures"), rows: rows(FixtureSchema) }),
  z.object({ section: z.literal("team_stats"), rows: rows(TeamStatSchema) }),
  z.object({ section: z.literal("forecasts"), model_run_id: id, rows: rows(ForecastSchema) }),
  z.object({ section: z.literal("archive"), model_run_id: id, backtest_run_id: id, rows: rows(ArchiveSchema) }),
  z.object({ section: z.literal("drivers"), model_run_id: id, rows: rows(DriverSchema) }),
  z.object({ section: z.literal("reports"), model_run_id: id, rows: rows(ReportSchema) }),
  z.object({ section: z.literal("evaluations"), model_run_id: id, backtest_run_id: id, rows: rows(EvaluationSchema) }),
  z.object({ section: z.literal("odds"), model_run_id: id, rows: rows(OddsSchema) }),
]);
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export interface ImportContext {
  actorId: string | null;
  now: string;
}

export interface ImportResult {
  section: string;
  received: number;
  written: number;
  rejected: Array<{ index: number; reason: string }>;
  /** Live rows stored after kickoff (server clock): kept, but never marked as published before kickoff. */
  late?: number;
}

type Row = Record<string, unknown>;

/** Multi-row INSERT honouring D1's 100-bound-parameter limit. */
function insertMany(db: D1Database, verb: string, table: string, cols: string[], data: unknown[][], suffix = ""): D1PreparedStatement[] {
  const per = Math.max(1, Math.floor(99 / cols.length));
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < data.length; i += per) {
    const chunk = data.slice(i, i + per);
    const ph = chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
    out.push(db.prepare(`${verb} INTO ${table} (${cols.join(",")}) VALUES ${ph} ${suffix}`).bind(...chunk.flat()));
  }
  return out;
}

async function runBatches(db: D1Database, stmts: D1PreparedStatement[], size = 40): Promise<number> {
  let changes = 0;
  for (let i = 0; i < stmts.length; i += size) {
    const res = await db.batch(stmts.slice(i, i + size));
    for (const r of res) changes += r.meta?.changes ?? 0;
  }
  return changes;
}

async function kickoffs(db: D1Database, fixtureIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fixtureIds)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const res = await db
      .prepare(`SELECT id, starts_at_utc FROM fixtures WHERE id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ id: string; starts_at_utc: string }>();
    for (const r of res.results) map.set(r.id, r.starts_at_utc);
  }
  return map;
}

async function runInfo(db: D1Database, runId: string) {
  return db.prepare("SELECT id, model_version, generated_at, data_as_of_at, dataset_hash, data_mode FROM model_runs WHERE id = ?").bind(runId).first<{
    id: string; model_version: string; generated_at: string; data_as_of_at: string; dataset_hash: string; data_mode: string;
  }>();
}

export async function importSection(db: D1Database, req: ImportRequest, ctx: ImportContext): Promise<ImportResult> {
  const result: ImportResult = { section: req.section, received: 0, written: 0, rejected: [] };
  switch (req.section) {
    case "run": {
      result.received = 2;
      const existing = await runInfo(db, req.model_run.id);
      if (existing) {
        if (existing.dataset_hash !== req.model_run.dataset_hash) {
          throw new Error(`model run ${req.model_run.id} already exists with a different dataset hash; publish a new run id`);
        }
        return result; // idempotent re-import
      }
      const m = req.model_run;
      const cols = ["id", "model_version", "pipeline_version", "dataset_hash", "data_mode", "generated_at", "data_as_of_at", "calibration_version", "market_catalog_version", "config_json", "imported_at", "imported_by"];
      const base = [m.model_version, m.pipeline_version, m.dataset_hash, req.data_mode, m.generated_at, m.data_as_of_at, m.calibration_version, m.market_catalog_version];
      result.written = await runBatches(db, [
        ...insertMany(db, "INSERT", "model_runs", cols, [
          [m.id, ...base, JSON.stringify(m.config), ctx.now, ctx.actorId],
          [req.backtest_run.id, ...base, JSON.stringify({ kind: "backtest", description: req.backtest_run.description }), ctx.now, ctx.actorId],
        ]),
        ...marketDefinitionStatements(db),
      ]);
      return result;
    }
    case "reference": {
      result.received = req.competitions.length + req.teams.length + req.referees.length;
      const s: D1PreparedStatement[] = [];
      s.push(...insertMany(db, "INSERT", "competitions",
        ["id", "provider", "provider_id", "name", "short_name", "country", "is_synthetic", "current_season", "source_updated_at", "rights_status"],
        req.competitions.map((c) => [c.id, c.provider, c.provider_id, c.name, c.short_name, c.country, c.is_synthetic, c.current_season ?? null, ctx.now, c.is_synthetic ? "synthetic_no_rights_needed" : "review_required"]),
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, current_season=excluded.current_season, source_updated_at=excluded.source_updated_at"));
      s.push(...insertMany(db, "INSERT", "teams",
        ["id", "provider", "provider_id", "name", "short_name", "code", "country", "primary_color", "secondary_color", "competition_id", "is_synthetic", "source_updated_at"],
        req.teams.map((t) => [t.id, t.provider, t.provider_id, t.name, t.short_name, t.code ?? null, t.country ?? null, t.primary_color ?? null, t.secondary_color ?? null, t.competition_id ?? null, t.is_synthetic, ctx.now]),
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, source_updated_at=excluded.source_updated_at"));
      s.push(...insertMany(db, "INSERT", "referees", ["id", "name", "is_synthetic"], req.referees.map((r) => [r.id, r.name, r.is_synthetic]), "ON CONFLICT(id) DO NOTHING"));
      result.written = await runBatches(db, s);
      return result;
    }
    case "fixtures": {
      result.received = req.rows.length;
      const data = req.rows.map((f) => {
        const score = { fulltime: { home: f.home_goals ?? null, away: f.away_goals ?? null }, halftime: { home: f.home_goals_ht ?? null, away: f.away_goals_ht ?? null } };
        return [f.id, f.provider, f.provider_id, f.competition_id, f.season, f.round ?? null, f.home_team_id, f.away_team_id, f.starts_at_utc, f.status,
          f.home_goals ?? null, f.away_goals ?? null, f.home_goals_ht ?? null, f.away_goals_ht ?? null, JSON.stringify(score),
          f.venue_name ?? null, f.venue_city ?? null, f.referee_id ?? null, f.is_synthetic, ctx.now, ctx.now];
      });
      result.written = await runBatches(db, insertMany(db, "INSERT", "fixtures",
        ["id", "provider", "provider_id", "competition_id", "season", "round", "home_team_id", "away_team_id", "starts_at_utc", "status",
          "home_goals", "away_goals", "home_goals_ht", "away_goals_ht", "score_json", "venue_name", "venue_city", "referee_id", "is_synthetic", "provider_last_updated", "ingested_at"],
        data,
        "ON CONFLICT(id) DO UPDATE SET status=excluded.status, starts_at_utc=excluded.starts_at_utc, home_goals=excluded.home_goals, away_goals=excluded.away_goals, home_goals_ht=excluded.home_goals_ht, away_goals_ht=excluded.away_goals_ht, score_json=excluded.score_json, referee_id=excluded.referee_id, provider_last_updated=excluded.provider_last_updated"));
      return result;
    }
    case "team_stats": {
      result.received = req.rows.length;
      result.written = await runBatches(db, insertMany(db, "INSERT", "fixture_team_stats",
        ["fixture_id", "team_id", "corners", "yellow_cards", "red_cards", "shots", "shots_on_target", "possession_pct", "xg", "source", "captured_at"],
        req.rows.map((r) => [r.fixture_id, r.team_id, r.corners ?? null, r.yellow_cards ?? null, r.red_cards ?? null, r.shots ?? null, r.shots_on_target ?? null, r.possession_pct ?? null, r.xg ?? null, "artifact-import", ctx.now]),
        "ON CONFLICT(fixture_id, team_id) DO UPDATE SET corners=excluded.corners, yellow_cards=excluded.yellow_cards, red_cards=excluded.red_cards, shots=excluded.shots, shots_on_target=excluded.shots_on_target, possession_pct=excluded.possession_pct"));
      return result;
    }
    case "forecasts":
    case "archive": {
      result.received = req.rows.length;
      const run = await runInfo(db, req.model_run_id);
      if (!run) throw new Error(`unknown model run ${req.model_run_id}; import the 'run' section first`);
      const ko = await kickoffs(db, req.rows.map((r) => r.fixture_id));
      const isArchive = req.section === "archive";
      const runId = isArchive ? req.backtest_run_id : req.model_run_id;
      const data: unknown[][] = [];
      req.rows.forEach((r, index) => {
        const kickoff = ko.get(r.fixture_id);
        if (!kickoff) return result.rejected.push({ index, reason: "unknown fixture" });
        if (!marketById.has(r.market_id)) return result.rejected.push({ index, reason: "unknown market" });
        const asOf = (r as { data_as_of_at?: string | null }).data_as_of_at ?? run.data_as_of_at;
        if (ms(asOf) >= ms(kickoff)) return result.rejected.push({ index, reason: "data_as_of_at is not before kickoff (leakage)" });
        if (!isArchive && ms(run.generated_at) >= ms(kickoff)) return result.rejected.push({ index, reason: "forecast generated after kickoff cannot be stored as pre-kickoff" });
        // R-03: "pre-kickoff" means the SERVER stored the row before kickoff. A late row is kept for the record but can
        // never count as a published pre-kickoff forecast, whatever timestamps the artifact claims.
        const late = !isArchive && ms(ctx.now) >= ms(kickoff);
        if (late) result.late = (result.late ?? 0) + 1;
        if (r.status === "INSUFFICIENT" && r.probability !== null) return result.rejected.push({ index, reason: "INSUFFICIENT forecasts must not carry a probability" });
        const unc = isArchive ? {} : (r as { uncertainty: unknown }).uncertainty;
        data.push([
          `fc_${runId.replace(/[^a-zA-Z0-9]/g, "")}_${r.fixture_id}_${r.market_id}`, r.fixture_id, r.market_id, runId, r.probability,
          run.model_version, run.generated_at, asOf, run.dataset_hash, r.status, r.quality_reason, JSON.stringify(unc),
          isArchive || late ? 0 : 1, isArchive ? (r as { settled_outcome: number | null }).settled_outcome : null, isArchive ? ctx.now : null, ctx.now,
        ]);
      });
      result.written = await runBatches(db, insertMany(db, "INSERT OR IGNORE", "forecasts",
        ["id", "fixture_id", "market_definition_id", "model_run_id", "probability", "model_version", "generated_at", "data_as_of_at", "dataset_hash", "status", "quality_reason", "uncertainty_json", "is_pre_kickoff", "settled_outcome", "settled_at", "published_at"],
        data));
      return result;
    }
    case "drivers": {
      result.received = req.rows.length;
      result.written = await runBatches(db, insertMany(db, "INSERT OR IGNORE", "forecast_evidence",
        ["id", "fixture_id", "model_run_id", "model_family", "metric", "value", "value_json", "sample_window", "source_ref", "captured_at"],
        req.rows.map((r) => [`fe_${req.model_run_id.replace(/[^a-zA-Z0-9]/g, "")}_${r.fixture_id}_${r.model_family}_${r.metric}`, r.fixture_id, req.model_run_id, r.model_family, r.metric, r.value,
          r.value_json == null ? null : JSON.stringify(r.value_json), r.sample_window ?? null, r.source_ref ?? null, ctx.now])));
      return result;
    }
    case "reports": {
      result.received = req.rows.length;
      const run = await runInfo(db, req.model_run_id);
      if (!run) throw new Error(`unknown model run ${req.model_run_id}`);
      result.written = await runBatches(db, insertMany(db, "INSERT OR IGNORE", "match_reports",
        ["id", "fixture_id", "report_version", "model_run_id", "report_status", "featured_market_id", "summary_json", "analysis_json", "evidence_manifest_json", "generated_at"],
        req.rows.map((r) => [`mr_${r.fixture_id}_${run.id.replace(/[^a-zA-Z0-9]/g, "")}`, r.fixture_id, run.id, run.id, run.data_mode === "SIMULATED_DEMO" ? "SIMULATED_DEMO" : "PUBLISHED",
          r.featured_market_id, JSON.stringify(r.summary), JSON.stringify(r.analysis),
          JSON.stringify({ model_run_id: run.id, dataset_hash: run.dataset_hash, data_as_of_at: run.data_as_of_at, market_catalog_version: catalog.version }), run.generated_at]), ""), 10);
      return result;
    }
    case "evaluations": {
      result.received = req.rows.length;
      const run = await runInfo(db, req.model_run_id);
      if (!run) throw new Error(`unknown model run ${req.model_run_id}`);
      result.written = await runBatches(db, insertMany(db, "INSERT OR IGNORE", "model_evaluations",
        ["id", "model_run_id", "model_version", "market_family", "competition_id", "period", "sample_n", "brier", "log_loss", "baseline_brier", "baseline_log_loss", "calibration_json", "data_mode", "evaluated_at"],
        req.rows.map((e) => [`ev_${req.backtest_run_id.replace(/[^a-zA-Z0-9]/g, "")}_${e.market_family}_${e.competition_id ?? "ALL"}`, req.backtest_run_id, run.model_version, e.market_family, e.competition_id,
          "rolling-origin backtest (recent completed rounds)", e.sample_n, e.brier, e.log_loss, e.baseline_brier, e.baseline_log_loss, JSON.stringify(e.calibration), run.data_mode, run.generated_at])), 10);
      return result;
    }
    case "odds": {
      result.received = req.rows.length;
      const run = await runInfo(db, req.model_run_id);
      if (!run) throw new Error(`unknown model run ${req.model_run_id}`);
      const ko = await kickoffs(db, req.rows.map((r) => r.fixture_id));
      const data: unknown[][] = [];
      req.rows.forEach((o, index) => {
        const kickoff = ko.get(o.fixture_id);
        if (!kickoff || !marketById.has(o.market_id)) return result.rejected.push({ index, reason: "unknown fixture or market" });
        data.push([`bk_${o.fixture_id}_${o.market_id}_${run.id.replace(/[^a-zA-Z0-9]/g, "")}`, o.fixture_id, o.market_id, o.bookmaker_name, o.odds_decimal, run.generated_at, kickoff, o.provider_source, o.provider_source.startsWith("synthetic") ? 1 : 0]);
      });
      result.written = await runBatches(db, insertMany(db, "INSERT OR IGNORE", "bookmaker_snapshots",
        ["id", "fixture_id", "market_definition_id", "bookmaker_name", "odds_decimal", "collected_at", "stale_after", "provider_source", "is_synthetic"], data));
      return result;
    }
  }
}

function marketDefinitionStatements(db: D1Database): D1PreparedStatement[] {
  return insertMany(db, "INSERT", "market_definitions",
    ["id", "family", "category", "settlement_period", "label", "short_label", "selection", "threshold", "tier", "model_family", "required_data", "definition_json", "validation_status", "licensing_status", "active_for_beta", "display_order", "version"],
    catalog.markets.map((m) => [m.id, m.family, m.category, m.settlement_period, m.label, m.short_label, m.selection, m.threshold, m.tier, m.model_family,
      JSON.stringify(m.required_data), JSON.stringify({ predicate: m.predicate, settlement_rules: m.settlement_rules, exclusive_group: m.exclusive_group ?? null }),
      m.validation_status, m.licensing_status, m.active_for_beta ? 1 : 0, m.display_order, m.version]),
    "ON CONFLICT(id) DO UPDATE SET label=excluded.label, short_label=excluded.short_label, definition_json=excluded.definition_json, display_order=excluded.display_order, version=excluded.version");
}

// ------------------------------------------------------------------ artifact helpers (seed + CLI)

export interface Artifact {
  data_mode: "SIMULATED_DEMO" | "FREE_API" | "PRODUCTION";
  anchor_utc: string;
  model_run: z.infer<typeof ModelRunSchema>;
  backtest_run: { id: string; description: string };
  competitions: Row[];
  teams: Row[];
  referees: Row[];
  fixtures: Row[];
  team_stats: Row[];
  forecasts: Row[];
  drivers: Row[];
  reports: Row[];
  archive_forecasts: Row[];
  evaluations: Row[];
  bookmaker_snapshots: Row[];
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Shift every ISO timestamp by `ms`. Only for SYNTHETIC demo artifacts (re-anchors them to "today"). */
export function shiftArtifact<T>(value: T, ms: number): T {
  if (ms === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && TS_RE.test(v)) return new Date(Date.parse(v) + ms).toISOString().replace(".000Z", "Z");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Split an artifact into validated import requests, in dependency order. */
export function* artifactRequests(a: Artifact, chunk = 400): Generator<unknown> {
  const runId = a.model_run.id;
  const backtestId = a.backtest_run.id;
  yield { section: "run", data_mode: a.data_mode, model_run: a.model_run, backtest_run: a.backtest_run };
  yield { section: "reference", competitions: a.competitions, teams: a.teams, referees: a.referees };
  const parts = <T>(arr: T[]) => Array.from({ length: Math.ceil(arr.length / chunk) }, (_, i) => arr.slice(i * chunk, (i + 1) * chunk));
  for (const p of parts(a.fixtures)) yield { section: "fixtures", rows: p };
  for (const p of parts(a.team_stats)) yield { section: "team_stats", rows: p };
  for (const p of parts(a.forecasts)) yield { section: "forecasts", model_run_id: runId, rows: p };
  for (const p of parts(a.archive_forecasts)) yield { section: "archive", model_run_id: runId, backtest_run_id: backtestId, rows: p };
  for (const p of parts(a.drivers)) yield { section: "drivers", model_run_id: runId, rows: p };
  for (const p of parts(a.reports)) yield { section: "reports", model_run_id: runId, rows: p };
  for (const p of parts(a.evaluations)) yield { section: "evaluations", model_run_id: runId, backtest_run_id: backtestId, rows: p };
  for (const p of parts(a.bookmaker_snapshots)) yield { section: "odds", model_run_id: runId, rows: p };
}
