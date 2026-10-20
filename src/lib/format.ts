// All kick-off times are stored in UTC and presented in Uganda time (EAT, UTC+3).
const TZ = "Africa/Kampala";

export const pct = (p: number | null | undefined, digits = 0) => (p == null ? "-" : `${(p * 100).toFixed(digits)}%`);
export const odds = (d: number | null | undefined) => (d == null ? "-" : d.toFixed(2));

export function kickoffTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));
}
export function kickoffDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: TZ }).format(new Date(iso));
}
export function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(new Date(iso));
}
export function dateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso)) + " EAT";
}
export function utcTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

/** YYYY-MM-DD in EAT for a Date. */
export function eatYmd(d = new Date()) {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function ymdLabel(ymd: string) {
  const today = eatYmd();
  if (ymd === today) return "Today";
  if (ymd === addDays(today, 1)) return "Tomorrow";
  if (ymd === addDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ymd + "T12:00:00Z"));
}

export function statusLabel(s: string) {
  return (
    {
      NS: "Not started", TBD: "Time TBD", LIVE: "Live", HT: "Half-time", FT: "Full-time", AET: "After extra time", PEN: "Penalties",
      PST: "Postponed", CANC: "Cancelled", ABD: "Abandoned", AWD: "Awarded", WO: "Walkover", AWAITING_RESULT: "Awaiting result",
    } as Record<string, string>
  )[s] ?? s;
}

export function initials(name: string) {
  const generic = /\b(FC|CF|SD|UD|CD|SK|AC|AS|United|Athletic|Rovers|Rangers|Wanderers|Town|City|Harriers|Albion)\b/g;
  const parts = name.replace(generic, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return name.slice(0, 2).toUpperCase();
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export const qualityLabel: Record<string, { label: string; tone: string; help: string }> = {
  VERIFIED: { label: "Verified data", tone: "pill-green", help: "All required source records were present and the sample met minimum size." },
  PARTIAL: { label: "Partial", tone: "pill-amber", help: "Some inputs were missing or the market family is still experimental." },
  INSUFFICIENT: { label: "Insufficient evidence", tone: "pill-red", help: "Required records were missing or the sample was too small, so no probability is published." },
  STALE: { label: "Stale", tone: "pill-amber", help: "Inputs are older than the freshness threshold." },
  SIMULATED_DEMO: { label: "Synthetic demo", tone: "pill-demo", help: "Generated from fictional demo data. Not a real forecast." },
  RESEARCH: { label: "Research only", tone: "pill-blue", help: "Experimental model output pending validation." },
  NOT_MODELLED: { label: "Not modelled", tone: "pill-gray", help: "This market was not modelled for this fixture." },
  NO_REPORT: { label: "No report", tone: "pill-gray", help: "No report has been prepared for this fixture." },
};

export const metricLabels: Record<string, string> = {
  expected_goals_home: "Expected goals: home",
  expected_goals_away: "Expected goals: away",
  rho_low_score_correction: "Low-score correction (rho)",
  home_advantage_multiplier: "Home advantage multiplier",
  attack_multiplier_home: "Home attack rating (x avg)",
  defence_multiplier_home: "Home defence rating (x avg conceded)",
  attack_multiplier_away: "Away attack rating (x avg)",
  defence_multiplier_away: "Away defence rating (x avg conceded)",
  league_avg_goals_weighted: "League avg goals/match (weighted)",
  training_matches: "Training matches",
  effective_sample_after_decay: "Effective sample after time decay",
  time_decay_half_life_days: "Time-decay half-life (days)",
  matches_home_team: "Matches available: home team",
  matches_away_team: "Matches available: away team",
  expected_ht_goals_home: "Expected first-half goals: home",
  expected_ht_goals_away: "Expected first-half goals: away",
  expected_corners_home: "Expected corners: home",
  expected_corners_away: "Expected corners: away",
  dispersion_alpha: "Over-dispersion (alpha)",
  observed_variance_to_mean_per_team: "Observed variance / mean",
  expected_total_yellows: "Expected total yellow cards",
  league_avg_total_yellows_weighted: "League avg yellows/match (weighted)",
  home_team_multiplier: "Home team card multiplier",
  away_team_multiplier: "Away team card multiplier",
  referee_multiplier_shrunk: "Referee multiplier (shrunk)",
  referee_training_matches: "Referee matches in sample",
};
