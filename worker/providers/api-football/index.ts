/**
 * API-Football (API-SPORTS v3) adapter. All calls go through meteredGet (shared D1 budget).
 * Field names follow the documented v3 response envelope:
 *   { get, parameters, errors, results, paging, response: [...] }
 * fixtures item: { fixture: { id, referee, date, status: { short } , venue: { name, city } },
 *                  league: { id, name, country, season, round }, teams: { home: { id, name }, away },
 *                  goals: { home, away }, score: { halftime: { home, away } },
 *                  statistics?: [{ team: { id }, statistics: [{ type, value }] }] }   // present on ids= queries
 * Re-verify against https://www.api-football.com/documentation-v3 before relying on new fields.
 */
import type { Env } from "../../env.ts";
import { meteredGet, type Priority } from "../../services/sports/budget.ts";
import type { FixtureBundle, NormalizedCompetition, NormalizedFixture, NormalizedTeam, NormalizedTeamStats, OddsSnapshot, QuotaState, SportsDataProvider } from "../types.ts";

interface ApiTeam { id: number; name: string; code?: string | null; country?: string | null }
interface ApiFixtureItem {
  fixture: { id: number; referee: string | null; date: string; status: { short: string }; venue?: { name: string | null; city: string | null } | null; periods?: unknown };
  league: { id: number; name: string; country: string; season: number; round?: string | null };
  teams: { home: ApiTeam; away: ApiTeam };
  goals: { home: number | null; away: number | null };
  score: { halftime?: { home: number | null; away: number | null } | null; fulltime?: { home: number | null; away: number | null } | null };
  statistics?: Array<{ team: { id: number }; statistics: Array<{ type: string; value: number | string | null }> }>;
}
interface Envelope<T> { response: T[]; results: number; errors: unknown }

const STATUS_MAP: Record<string, NormalizedFixture["status"]> = {
  TBD: "TBD", NS: "NS", "1H": "LIVE", HT: "HT", "2H": "LIVE", ET: "LIVE", BT: "LIVE", P: "LIVE", SUSP: "LIVE", INT: "LIVE", LIVE: "LIVE",
  FT: "FT", AET: "AET", PEN: "PEN", PST: "PST", CANC: "CANC", ABD: "ABD", AWD: "AWD", WO: "WO",
};

export const compId = (leagueId: number | string) => `apif:${leagueId}`;
export const teamId = (id: number | string) => `apif:team:${id}`;
export const fixtureId = (id: number | string) => `apif:fx:${id}`;
const refId = (name: string) => `apif:ref:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function toInt(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeFixtures(items: ApiFixtureItem[], fetchedAt: string): FixtureBundle {
  const comps = new Map<string, NormalizedCompetition>();
  const teams = new Map<string, NormalizedTeam>();
  const fixtures: NormalizedFixture[] = [];
  const stats: NormalizedTeamStats[] = [];
  for (const it of items) {
    const cid = compId(it.league.id);
    comps.set(cid, { id: cid, provider: "api_football", provider_id: String(it.league.id), name: it.league.name, short_name: it.league.name, country: it.league.country, is_synthetic: 0, current_season: String(it.league.season) });
    for (const t of [it.teams.home, it.teams.away]) {
      teams.set(teamId(t.id), { id: teamId(t.id), provider: "api_football", provider_id: String(t.id), name: t.name, short_name: t.name, code: t.code ?? null, country: t.country ?? null, primary_color: null, secondary_color: null, competition_id: cid, is_synthetic: 0 });
    }
    const referee = it.fixture.referee ? it.fixture.referee.split(",")[0].trim() : null;
    const fid = fixtureId(it.fixture.id);
    fixtures.push({
      id: fid, provider: "api_football", provider_id: String(it.fixture.id), competition_id: cid, season: String(it.league.season), round: it.league.round ?? null,
      home_team_id: teamId(it.teams.home.id), away_team_id: teamId(it.teams.away.id),
      starts_at_utc: new Date(it.fixture.date).toISOString().replace(".000Z", "Z"),
      status: STATUS_MAP[it.fixture.status.short] ?? "TBD",
      // Regulation-time score: API-Football `score.fulltime` excludes extra time; `goals` may include it.
      home_goals: it.score?.fulltime?.home ?? it.goals.home, away_goals: it.score?.fulltime?.away ?? it.goals.away,
      home_goals_ht: it.score?.halftime?.home ?? null, away_goals_ht: it.score?.halftime?.away ?? null,
      venue_name: it.fixture.venue?.name ?? null, venue_city: it.fixture.venue?.city ?? null,
      referee_id: referee ? refId(referee) : null, referee_name: referee,
      is_synthetic: 0, provider_last_updated: fetchedAt,
    });
    for (const s of it.statistics ?? []) {
      const get = (type: string) => toInt(s.statistics.find((x) => x.type.toLowerCase() === type.toLowerCase())?.value ?? null);
      stats.push({
        fixture_id: fid, team_id: teamId(s.team.id),
        corners: get("Corner Kicks"), yellow_cards: get("Yellow Cards"), red_cards: get("Red Cards"),
        shots: get("Total Shots"), shots_on_target: get("Shots on Goal"), possession_pct: get("Ball Possession"),
        xg: get("expected_goals"),
      });
    }
  }
  return { competitions: [...comps.values()], teams: [...teams.values()], fixtures, stats };
}

// Map provider bet names to our market taxonomy. Only exact, verified mappings; everything else is ignored.
const ODDS_MAP: Record<string, (value: string) => string | null> = {
  "Match Winner": (v) => ({ Home: "MATCH_RESULT_HOME_REGULATION", Draw: "MATCH_RESULT_DRAW_REGULATION", Away: "MATCH_RESULT_AWAY_REGULATION" })[v] ?? null,
  "Double Chance": (v) => ({ "Home/Draw": "DOUBLE_CHANCE_HOME_DRAW_REGULATION", "Draw/Away": "DOUBLE_CHANCE_DRAW_AWAY_REGULATION", "Home/Away": "DOUBLE_CHANCE_HOME_AWAY_REGULATION" })[v] ?? null,
  "Both Teams Score": (v) => ({ Yes: "BTTS_YES_REGULATION", No: "BTTS_NO_REGULATION" })[v] ?? null,
  "Goals Over/Under": (v) => {
    const m = /^(Over|Under) (\d+\.5)$/.exec(v);
    if (!m || !["0.5", "1.5", "2.5", "3.5", "4.5"].includes(m[2])) return null;
    return `TOTAL_GOALS_${m[1].toUpperCase()}_${m[2].replace(".", "_")}_REGULATION`;
  },
};

export class ApiFootballProvider implements SportsDataProvider {
  readonly name = "api_football";
  private env: Env;
  private jobId: string | null;
  private priority: Priority;
  constructor(env: Env, opts: { jobId?: string | null; priority?: Priority } = {}) {
    this.env = env;
    this.jobId = opts.jobId ?? null;
    this.priority = opts.priority ?? "normal";
  }

  async listFixtures(input: { date?: string; league?: string; season?: string; team?: string; last?: number }): Promise<FixtureBundle> {
    // Settled seasons never change: cache snapshots for 7 days; date/day boards for 3 hours.
    const ttl = input.date ? 3 * 3600 : input.last ? 6 * 3600 : 7 * 86400;
    const res = await meteredGet<Envelope<ApiFixtureItem>>(this.env, "/fixtures",
      { date: input.date, league: input.league, season: input.season, team: input.team, last: input.last, timezone: "UTC" },
      { ttlSec: ttl, priority: this.priority, jobId: this.jobId });
    return normalizeFixtures(res.body.response, res.fetchedAt);
  }

  /** Up to 20 fixture ids per call; the response embeds statistics for each fixture. */
  async getFixtures(providerIds: string[]): Promise<FixtureBundle> {
    if (providerIds.length > 20) throw new Error("API-Football accepts at most 20 ids per request");
    const res = await meteredGet<Envelope<ApiFixtureItem>>(this.env, "/fixtures", { ids: providerIds.join("-"), timezone: "UTC" },
      { ttlSec: 6 * 3600, priority: this.priority, jobId: this.jobId });
    return normalizeFixtures(res.body.response, res.fetchedAt);
  }

  async getOdds(fixtureProviderId: string): Promise<OddsSnapshot[]> {
    const res = await meteredGet<Envelope<{ update: string; bookmakers: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string }> }> }> }>>(
      this.env, "/odds", { fixture: fixtureProviderId }, { ttlSec: 3 * 3600, priority: this.priority, jobId: this.jobId });
    const out: OddsSnapshot[] = [];
    for (const item of res.body.response) {
      for (const bk of item.bookmakers ?? []) {
        for (const bet of bk.bets ?? []) {
          const map = ODDS_MAP[bet.name];
          if (!map) continue;
          for (const v of bet.values ?? []) {
            const mid = map(String(v.value));
            const odd = parseFloat(v.odd);
            if (mid && odd > 1) out.push({ fixture_id: fixtureId(fixtureProviderId), market_id: mid, bookmaker_name: bk.name, odds_decimal: odd, collected_at: item.update ?? res.fetchedAt, provider_source: "api_football:/odds" });
          }
        }
      }
    }
    return out;
  }

  async getQuotaState(): Promise<QuotaState> {
    // GET /status is a documented endpoint; we still COUNT it against the budget (never assume it is free).
    const res = await meteredGet<{ response: { subscription?: { plan?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } } }>(
      this.env, "/status", {}, { ttlSec: 0, priority: "reserve", jobId: this.jobId });
    const r = res.body.response;
    return { limit: r?.requests?.limit_day ?? null, used: r?.requests?.current ?? null, plan: r?.subscription?.plan ?? null, active: r?.subscription?.active ?? null };
  }
}
