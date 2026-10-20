/**
 * Deterministic, evidence-grounded explanation templates. Every number in the output is taken
 * directly from the computed evidence/forecast objects. No causal claims, no certainty language.
 * This is the default (and, in beta, the only) explanation layer; Gemini is optional and off.
 */
import type { MarketDef } from "../../shared/markets.ts";

interface SetLike {
  key: string;
  title: string;
  sample: number;
  settled: number;
  hits: number;
  rate: number | null;
  averages: Record<string, number | null>;
}

interface Input {
  market: MarketDef;
  forecast: { probability: number | null; status: string; quality_reason: string | null; uncertainty: { p05?: number; p95?: number } | null };
  sets: SetLike[];
  league: SetLike;
  homeName: string;
  awayName: string;
  kind: "goals" | "corners" | "cards";
  referee: string | null;
  isDemo: boolean;
}

const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

function symmetric(m: MarketDef) {
  return m.predicate.type === "total" || m.predicate.type === "btts";
}

function occurrence(m: MarketDef, s: SetLike): string {
  if (!s.settled) return `${s.title}: no settled matches available.`;
  const what = symmetric(m) ? `${m.short_label.toLowerCase()} occurred` : "the equivalent outcome occurred";
  return `${s.title}: ${what} in ${s.hits} of ${s.settled} (${pct(s.rate)}).`;
}

export interface Narrative {
  headline: string;
  paragraphs: string[];
  caveats: string[];
  generated_by: "deterministic-template-v1";
}

export function explainMarket(i: Input): Narrative {
  const { market, forecast, sets, league } = i;
  const byKey = Object.fromEntries(sets.map((s) => [s.key, s]));
  const paragraphs: string[] = [];
  const caveats: string[] = [];

  if (forecast.probability == null) {
    paragraphs.push(`No probability is published for ${market.label}. Reason: ${forecast.quality_reason ?? "insufficient evidence"}.`);
  } else {
    const iv = forecast.uncertainty?.p05 != null && forecast.uncertainty?.p95 != null ? ` (range ${pct(forecast.uncertainty.p05)} to ${pct(forecast.uncertainty.p95)})` : "";
    const how =
      i.kind === "goals"
        ? "the teams' estimated attack and defence ratings (opponent-adjusted, older matches down-weighted) combined into a full scoreline distribution"
        : i.kind === "corners"
          ? "each team's estimated corners-for and corners-against rates, with extra variance allowed (negative binomial)"
          : "team discipline effects and an assigned-referee effect, both shrunk towards the league average";
    paragraphs.push(`The model currently estimates ${pct(forecast.probability)} for ${market.label}${iv}, using ${how}.`);
  }

  const obs: string[] = [occurrence(market, byKey.home_recent_home), occurrence(market, byKey.away_recent_away)];
  if (i.kind === "goals") {
    const h = byKey.home_recent_all.averages;
    const a = byKey.away_recent_all.averages;
    obs.push(`Over their last 10 matches, ${i.homeName} averaged ${h.goals_for ?? "n/a"} goals scored and ${h.goals_against ?? "n/a"} conceded; ${i.awayName} averaged ${a.goals_for ?? "n/a"} scored and ${a.goals_against ?? "n/a"} conceded.`);
  } else if (i.kind === "corners") {
    const h = byKey.home_recent_all.averages;
    const a = byKey.away_recent_all.averages;
    obs.push(`Last 10 matches: ${i.homeName} averaged ${h.corners_for ?? "n/a"} corners for and ${h.corners_against ?? "n/a"} against (match totals: mean ${h.mean ?? "n/a"}, median ${h.median ?? "n/a"}); ${i.awayName} averaged ${a.corners_for ?? "n/a"} for and ${a.corners_against ?? "n/a"} against (mean total ${a.mean ?? "n/a"}).`);
  } else {
    const h = byKey.home_recent_all.averages;
    const a = byKey.away_recent_all.averages;
    obs.push(`Last 10 matches: ${i.homeName} received ${h.yellows_for ?? "n/a"} yellow cards per match on average and their opponents ${h.yellows_against ?? "n/a"}; ${i.awayName} received ${a.yellows_for ?? "n/a"} and their opponents ${a.yellows_against ?? "n/a"}.`);
    const ref = byKey.referee_recent;
    if (ref && ref.settled) {
      obs.push(`${i.referee ?? "The listed referee"} (assignment not confirmed): ${ref.hits} of ${ref.settled} recent matches (${pct(ref.rate)}) met this selection, with a mean of ${ref.averages.mean ?? "n/a"} yellow cards per match.`);
    } else {
      obs.push("No prior matches for the listed referee are available, so the model uses the league-average referee effect.");
    }
  }
  paragraphs.push(obs.join(" "));

  const h2h = byKey.head_to_head;
  paragraphs.push(
    h2h.settled
      ? `Head to head: ${h2h.settled} previous meeting${h2h.settled === 1 ? "" : "s"} (${occurrence(market, h2h).split(": ")[1].replace(/\.$/, "")}).`
      : "No previous meetings between these teams.",
  );
  if (league.settled) paragraphs.push(`League context: ${occurrence(market, league)}`);

  const smallest = Math.min(...sets.filter((s) => s.key !== "head_to_head").map((s) => s.settled));
  if (smallest < 10) caveats.push(`Smallest sample: ${smallest} matches.`);
  if (i.isDemo) caveats.unshift("SYNTHETIC DEMO DATA: teams, matches and figures are fictional.");

  const headline =
    forecast.probability == null
      ? `${market.label}: insufficient evidence`
      : `${market.label}: model ${pct(forecast.probability)} vs league base rate ${pct(league.rate)}`;
  return { headline, paragraphs, caveats, generated_by: "deterministic-template-v1" };
}
