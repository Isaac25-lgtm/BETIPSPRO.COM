export interface TeamRef {
  id: string;
  name: string;
  short_name: string;
  code: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

export interface FixtureSummary {
  id: string;
  starts_at_utc: string;
  status: string;
  display_status: string;
  round: string | null;
  score: { home: number | null; away: number | null };
  is_synthetic: boolean;
  is_public_sample: boolean;
  competition: { id: string; name: string; short_name: string; country: string; is_synthetic: boolean };
  home: TeamRef;
  away: TeamRef;
  report: { available: boolean; version: string | null };
  featured: null | {
    market_id: string;
    label: string;
    short_label: string;
    probability: number | null;
    status: string;
    odds: null | { decimal: number; bookmaker: string; is_synthetic: boolean; collected_at: string };
  };
}

export interface FixtureList {
  items: FixtureSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface FormEntry {
  fixture_id: string;
  starts_at_utc: string;
  competition: string;
  venue: "H" | "A";
  opponent: string;
  goals_for: number;
  goals_against: number;
  result: "W" | "D" | "L";
}

export interface MarketStub {
  id: string;
  label: string;
  short_label: string;
  category: string;
  tier: string;
  status: string;
}

export interface Preview {
  fixture: FixtureSummary & {
    season: string;
    venue: { name: string; city: string | null } | null;
    referee: { name: string; confirmed: boolean } | null;
    kickoff_confirmed: boolean;
    provider: string;
    provider_last_updated: string | null;
    rights_status: string;
  };
  form: { home: FormEntry[]; away: FormEntry[] };
  report: null | { version: string; generated_at: string; status: string; data_as_of_at: string | null; featured_rule: string | null; featured_base_rate: number | null; odds_snapshots: number };
  markets: MarketStub[];
  categories: string[];
  unsupported: Array<{ family: string; reason: string }>;
}

export interface ReportMarket {
  id: string;
  label: string;
  short_label: string;
  category: string;
  family: string;
  tier: string;
  settlement_period: string;
  probability: number | null;
  status: string;
  quality_reason: string | null;
  uncertainty: { p05?: number; p95?: number; method?: string; note?: string } | null;
  model_version: string | null;
  generated_at: string | null;
  price: null | { bookmaker: string; decimal: number; implied_probability: number; is_synthetic: boolean; stale: boolean };
}

export interface Report {
  fixture_id: string;
  report_version: string;
  report_status: string;
  generated_at: string;
  display_notice: string | null;
  access: "sample" | "admin" | "entitled";
  model_run: null | { id: string; model_version: string; pipeline_version: string; dataset_hash: string; data_mode: string; generated_at: string; data_as_of_at: string; market_catalog_version: string; config: Record<string, unknown> };
  summary: { featured?: { market_id: string; probability: number; league_base_rate: number; deviation: number; rule: string } | null; baselines?: Record<string, number>; competition_training_matches?: number; data_as_of_at?: string };
  analysis: { scoreline_matrix: number[][] | null; ht_matrix: number[][] | null; corners_total_pmf: number[] | null; cards_total_pmf: number[] | null };
  markets: ReportMarket[];
  drivers: Record<string, Array<{ metric: string; value: number | null; sample_window: string | null }>>;
  form: { home: FormEntry[]; away: FormEntry[] };
  head_to_head: Array<{ fixture_id: string; date: string; competition: string; home: string; away: string; score: string; ht_score: string | null }>;
  coverage: Record<string, string>;
  unsupported: Array<{ family: string; reason: string }>;
}

export interface EvidenceRow {
  fixture_id: string;
  date: string;
  competition: string;
  home: string;
  away: string;
  score: string;
  ht_score: string | null;
  venue: "H" | "A" | null;
  corners: { home: number | null; away: number | null; total: number | null };
  yellow_cards: { home: number | null; away: number | null; total: number | null };
  stat_value: number | null;
  hit: 0 | 1 | null;
  is_synthetic: boolean;
}

export interface EvidenceSet {
  key: string;
  title: string;
  window: string;
  perspective_team: string | null;
  sample: number;
  settled: number;
  hits: number;
  rate: number | null;
  averages: Record<string, number | null>;
  rows: EvidenceRow[];
}

export interface PriceView {
  bookmaker: string;
  is_synthetic: boolean;
  provider_source: string | null;
  decimal: number | null;
  implied_probability: number | null;
  normalized_probability: number | null;
  overround: number | null;
  collected_at: string | null;
  stale: boolean;
  group: Array<{ market_id: string; label: string; decimal: number | null }>;
}

export interface Evidence {
  fixture_id: string;
  market_id: string;
  market: { id: string; label: string; short_label: string; category: string; family: string; tier: string; settlement_period: string; settlement_rules: string; model_family: string; validation_status: string; threshold: number | null };
  fixture: { home: string; away: string; competition: string; starts_at_utc: string; referee: { name: string; confirmed: boolean } | null };
  report_version: string;
  forecast: { probability: number | null; status: string; quality_reason: string | null; uncertainty: { p05?: number; p95?: number; method?: string; note?: string } | null; model_version: string | null; forecast_generated_at: string | null; as_of_data_at: string | null; dataset_hash: string | null };
  evidence_kind: "goals" | "corners" | "cards";
  observed_evidence: EvidenceSet[];
  league_baseline: { title: string; window: string; sample: number; settled: number; hits: number; rate: number | null; averages: Record<string, number | null>; model_training_base_rate: number | null };
  distributions: { model: { type: string; stat?: string; period?: string; values: number[] | number[][] | null }; observed: { home_last10: Record<string, number>; away_last10: Record<string, number> } };
  model_drivers: Array<{ metric: string; value: number | null; sample_window: string | null }>;
  prices: PriceView[];
  narrative: { headline: string; paragraphs: string[]; caveats: string[]; generated_by: string };
  methodology: string;
  data_coverage: Record<string, unknown>;
  source_manifest: { source_fixture_ids: string[]; count: number; provider: string };
  display_notice: string | null;
  ai_summary: null | { summary: string; key_points: string[] };
  access: string;
}
