/**
 * football-data.org v4 adapter (free tier: 12 competitions, current season, 10 req/min).
 * Every call goes through meteredGet (shared D1 budget, provider "football_data_org").
 *
 * GET /competitions/{code}/matches?season=YYYY returns the whole season (played + scheduled) in ONE call:
 *   { competition, filters, resultSet, matches: [ { id, utcDate, status, matchday, stage, lastUpdated,
 *     homeTeam { id, name, shortName, tla }, awayTeam {...},
 *     score { winner, duration: REGULAR|EXTRA_TIME|PENALTY_SHOOTOUT, fullTime {home,away}, halfTime {home,away}, regularTime? },
 *     referees: [ { id, name, type } ], season { startDate, endDate } } ] }
 * The free tier has no corners/cards/lineups/odds, so those markets stay "Insufficient evidence".
 */
import type { Env } from "../../env.ts";
import { meteredGet, type Priority } from "../../services/sports/budget.ts";
import type { FixtureBundle, NormalizedCompetition, NormalizedFixture, NormalizedTeam } from "../types.ts";

/** Map football-data.org competition codes onto our canonical competition ids (league hubs). */
export const FDO_COMPETITIONS: Record<string, { id: string; name: string; country: string }> = {
  PL: { id: "apif:39", name: "Premier League", country: "England" },
  PD: { id: "apif:140", name: "La Liga", country: "Spain" },
  CL: { id: "apif:2", name: "UEFA Champions League", country: "Europe" },
  BL1: { id: "apif:78", name: "Bundesliga", country: "Germany" },
  SA: { id: "apif:135", name: "Serie A", country: "Italy" },
  FL1: { id: "apif:61", name: "Ligue 1", country: "France" },
  DED: { id: "fdo:DED", name: "Eredivisie", country: "Netherlands" },
  PPL: { id: "fdo:PPL", name: "Primeira Liga", country: "Portugal" },
  ELC: { id: "fdo:ELC", name: "Championship", country: "England" },
  BSA: { id: "fdo:BSA", name: "Brasileirão Série A", country: "Brazil" },
  WC: { id: "fdo:WC", name: "FIFA World Cup", country: "World" },
  EC: { id: "fdo:EC", name: "European Championship", country: "Europe" },
};

interface FdoTeam { id: number; name: string; shortName?: string | null; tla?: string | null }
interface FdoScore { home: number | null; away: number | null }
interface FdoMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number | null;
  stage?: string | null;
  lastUpdated?: string | null;
  homeTeam: FdoTeam;
  awayTeam: FdoTeam;
  score: { duration?: string | null; fullTime?: FdoScore | null; halfTime?: FdoScore | null; regularTime?: FdoScore | null };
  referees?: Array<{ id: number; name: string; type?: string | null }>;
  season?: { startDate?: string | null } | null;
  competition?: { id: number; name: string; code: string } | null;
}
interface FdoMatchesResponse { competition?: { code: string; name: string }; matches: FdoMatch[] }

const teamId = (id: number) => `fdo:team:${id}`;
const fixtureId = (id: number) => `fdo:fx:${id}`;
const refId = (name: string) => `fdo:ref:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function status(m: FdoMatch): NormalizedFixture["status"] {
  switch (m.status) {
    case "SCHEDULED":
    case "TIMED":
      return "NS";
    case "IN_PLAY":
      return "LIVE";
    case "PAUSED":
      return "HT";
    case "FINISHED":
      return m.score?.duration === "PENALTY_SHOOTOUT" ? "PEN" : m.score?.duration === "EXTRA_TIME" ? "AET" : "FT";
    case "POSTPONED":
      return "PST";
    case "SUSPENDED":
      return "ABD";
    case "CANCELLED":
      return "CANC";
    case "AWARDED":
      return "AWD";
    default:
      return "TBD";
  }
}

export function normalizeFdoMatches(code: string, body: FdoMatchesResponse, fetchedAt: string): FixtureBundle {
  const meta = FDO_COMPETITIONS[code] ?? { id: `fdo:${code}`, name: body.competition?.name ?? code, country: "" };
  const seasonOf = (m: FdoMatch) => (m.season?.startDate ?? m.utcDate).slice(0, 4);
  const season = body.matches.length ? seasonOf(body.matches[0]) : null;
  const competitions: NormalizedCompetition[] = [
    { id: meta.id, provider: "football_data_org", provider_id: code, name: meta.name, short_name: meta.name, country: meta.country, is_synthetic: 0, current_season: season },
  ];
  const teams = new Map<string, NormalizedTeam>();
  const fixtures: NormalizedFixture[] = [];
  for (const m of body.matches) {
    for (const t of [m.homeTeam, m.awayTeam]) {
      if (!t?.id) continue;
      teams.set(teamId(t.id), {
        id: teamId(t.id), provider: "football_data_org", provider_id: String(t.id), name: t.name,
        short_name: t.shortName || t.name, code: t.tla ?? null, country: meta.country || null,
        primary_color: null, secondary_color: null, competition_id: meta.id, is_synthetic: 0,
      });
    }
    if (!m.homeTeam?.id || !m.awayTeam?.id) continue; // knockout placeholders without teams yet
    const st = status(m);
    // Regulation-time score only: extra time/penalties must not settle 90-minute markets.
    const reg = m.score?.duration && m.score.duration !== "REGULAR" ? (m.score.regularTime ?? null) : (m.score?.fullTime ?? null);
    const finished = st === "FT" || st === "AET" || st === "PEN";
    const referee = m.referees?.find((r) => (r.type ?? "REFEREE") === "REFEREE")?.name ?? null;
    fixtures.push({
      id: fixtureId(m.id), provider: "football_data_org", provider_id: String(m.id), competition_id: meta.id,
      season: seasonOf(m), round: m.matchday ? `Matchday ${m.matchday}` : (m.stage ?? null),
      home_team_id: teamId(m.homeTeam.id), away_team_id: teamId(m.awayTeam.id),
      starts_at_utc: new Date(m.utcDate).toISOString().replace(".000Z", "Z"),
      status: st,
      home_goals: finished ? (reg?.home ?? null) : null, away_goals: finished ? (reg?.away ?? null) : null,
      home_goals_ht: finished ? (m.score?.halfTime?.home ?? null) : null, away_goals_ht: finished ? (m.score?.halfTime?.away ?? null) : null,
      venue_name: null, venue_city: null,
      referee_id: referee ? refId(referee) : null, referee_name: referee,
      is_synthetic: 0, provider_last_updated: m.lastUpdated ?? fetchedAt,
    });
  }
  return { competitions, teams: [...teams.values()], fixtures, stats: [] };
}

export class FootballDataOrgProvider {
  readonly name = "football_data_org";
  private env: Env;
  private jobId: string | null;
  private priority: Priority;
  constructor(env: Env, opts: { jobId?: string | null; priority?: Priority } = {}) {
    this.env = env;
    this.jobId = opts.jobId ?? null;
    this.priority = opts.priority ?? "normal";
  }

  /** Whole competition season (results + schedule). Re-fetching within 2h reuses the snapshot. */
  async competitionSeason(code: string, season?: string): Promise<FixtureBundle> {
    const res = await meteredGet<FdoMatchesResponse>(this.env, `/competitions/${code}/matches`, { season }, {
      ttlSec: 2 * 3600, priority: this.priority, jobId: this.jobId, provider: "football_data_org",
    });
    return normalizeFdoMatches(code, res.body, res.fetchedAt);
  }
}
