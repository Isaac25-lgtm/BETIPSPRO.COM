import catalogJson from "./market-catalog.json" with { type: "json" };

export type Predicate =
  | { type: "result"; period: "FT" | "HT"; sides: Array<"HOME" | "DRAW" | "AWAY"> }
  | { type: "total"; stat: "goals" | "corners" | "yellow_cards"; period: "FT" | "HT"; dir: "OVER" | "UNDER"; threshold: number }
  | { type: "btts"; period: "FT"; value: boolean }
  | { type: "team_total"; stat: "goals"; period: "FT"; side: "HOME" | "AWAY"; dir: "OVER" | "UNDER"; threshold: number }
  | { type: "correct_score"; period: "FT"; home: number; away: number }
  | { type: "correct_score_other"; period: "FT"; max: number };

export interface MarketDef {
  id: string;
  family: string;
  category: string;
  settlement_period: string;
  label: string;
  short_label: string;
  selection: string;
  threshold: number | null;
  tier: "A" | "B" | "C";
  model_family: string;
  required_data: string[];
  validation_status: string;
  licensing_status: string;
  active_for_beta: boolean;
  version: string;
  display_order: number;
  predicate: Predicate;
  settlement_rules: string;
  exclusive_group?: string;
}

export interface MarketCatalog {
  version: string;
  categories: string[];
  unsupported: Array<{ family: string; reason: string }>;
  markets: MarketDef[];
}

export const catalog = catalogJson as unknown as MarketCatalog;
export const marketById = new Map(catalog.markets.map((m) => [m.id, m]));

/** Outcome oriented to the target fixture: "home" means the side the market's HOME refers to. */
export interface Outcome {
  hg: number | null;
  ag: number | null;
  hth: number | null;
  ath: number | null;
  corners_total: number | null;
  yellow_total: number | null;
}

/** 1 = hit, 0 = miss, null = not settleable from available data. Mirrors model-pipeline markets.settle. */
export function settle(p: Predicate, o: Outcome): 0 | 1 | null {
  const h = p.period === "HT" ? o.hth : o.hg;
  const a = p.period === "HT" ? o.ath : o.ag;
  const needsScore = p.type !== "total" || p.stat === "goals";
  if (needsScore && (h == null || a == null)) return null;
  switch (p.type) {
    case "result": {
      const side = h! > a! ? "HOME" : h! < a! ? "AWAY" : "DRAW";
      return p.sides.includes(side) ? 1 : 0;
    }
    case "total": {
      const v = p.stat === "goals" ? h! + a! : p.stat === "corners" ? o.corners_total : o.yellow_total;
      if (v == null) return null;
      return (p.dir === "OVER" ? v > p.threshold : v < p.threshold) ? 1 : 0;
    }
    case "btts":
      return (h! > 0 && a! > 0) === p.value ? 1 : 0;
    case "team_total": {
      const v = p.side === "HOME" ? h! : a!;
      return (p.dir === "OVER" ? v > p.threshold : v < p.threshold) ? 1 : 0;
    }
    case "correct_score":
      return h === p.home && a === p.away ? 1 : 0;
    case "correct_score_other":
      return h! > p.max || a! > p.max ? 1 : 0;
  }
}

/** Which statistic family drives the historical evidence view for a market. */
export function evidenceKind(m: MarketDef): "goals" | "corners" | "cards" {
  if (m.predicate.type === "total" && m.predicate.stat === "corners") return "corners";
  if (m.predicate.type === "total" && m.predicate.stat === "yellow_cards") return "cards";
  return "goals";
}

export function exclusiveGroup(m: MarketDef): MarketDef[] {
  if (!m.exclusive_group) return [m];
  return catalog.markets.filter((x) => x.exclusive_group === m.exclusive_group);
}
