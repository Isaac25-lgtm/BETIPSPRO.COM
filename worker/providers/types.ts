/** Provider-neutral, normalised records. Every record carries provenance. */
export interface Provenance {
  provider: string;
  fetched_at: string;
  provider_ref: string;
  data_status: "complete" | "partial" | "missing";
}

export interface NormalizedCompetition {
  id: string;
  provider: string;
  provider_id: string;
  name: string;
  short_name: string;
  country: string;
  is_synthetic: 0 | 1;
  current_season: string | null;
}

export interface NormalizedTeam {
  id: string;
  provider: string;
  provider_id: string;
  name: string;
  short_name: string;
  code: string | null;
  country: string | null;
  primary_color: null;
  secondary_color: null;
  competition_id: string | null;
  is_synthetic: 0 | 1;
}

export interface NormalizedFixture {
  id: string;
  provider: string;
  provider_id: string;
  competition_id: string;
  season: string;
  round: string | null;
  home_team_id: string;
  away_team_id: string;
  starts_at_utc: string;
  status: "NS" | "TBD" | "LIVE" | "HT" | "FT" | "AET" | "PEN" | "PST" | "CANC" | "ABD" | "AWD" | "WO";
  home_goals: number | null;
  away_goals: number | null;
  home_goals_ht: number | null;
  away_goals_ht: number | null;
  venue_name: string | null;
  venue_city: string | null;
  referee_id: string | null;
  referee_name: string | null;
  is_synthetic: 0 | 1;
  provider_last_updated: string;
}

export interface NormalizedTeamStats {
  fixture_id: string;
  team_id: string;
  corners: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  shots: number | null;
  shots_on_target: number | null;
  possession_pct: number | null;
  xg: number | null;
}

export interface OddsSnapshot {
  fixture_id: string;
  market_id: string;
  bookmaker_name: string;
  odds_decimal: number;
  collected_at: string;
  provider_source: string;
}

export interface QuotaState {
  limit: number | null;
  used: number | null;
  plan: string | null;
  active: boolean | null;
}

export interface FixtureBundle {
  competitions: NormalizedCompetition[];
  teams: NormalizedTeam[];
  fixtures: NormalizedFixture[];
  stats: NormalizedTeamStats[];
}

export interface SportsDataProvider {
  readonly name: string;
  listFixtures(input: { date?: string; league?: string; season?: string; team?: string; last?: number }): Promise<FixtureBundle>;
  getFixtures(ids: string[]): Promise<FixtureBundle>;
  getOdds?(fixtureProviderId: string): Promise<OddsSnapshot[]>;
  getQuotaState?(): Promise<QuotaState>;
}
