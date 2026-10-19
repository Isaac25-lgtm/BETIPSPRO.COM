// Generates shared/market-catalog.json - the single versioned market taxonomy used by
// the Worker (evidence predicates, display) and the Python pipeline (probability derivation).
// Run: node scripts/build-market-catalog.mjs
import { writeFileSync } from "node:fs";

const VERSION = "markets-v1";
const markets = [];
let order = 0;
const fmt = (t) => String(t).replace(".", "_");

const REG = {
  period: "REGULATION_90",
  rule: "Settled on the score at the end of regulation time (90 minutes plus stoppage time). Extra time and penalty shoot-outs are excluded.",
};
const FH = {
  period: "FIRST_HALF",
  rule: "Settled on the half-time score only (first 45 minutes plus first-half stoppage time).",
};

function add(m) {
  markets.push({
    tier: "A",
    model_family: "goals_dixon_coles",
    required_data: ["final_score"],
    validation_status: "unvalidated",
    licensing_status: "review_required",
    active_for_beta: true,
    version: VERSION,
    display_order: ++order,
    ...m,
  });
}

// Match result (1X2)
for (const [sel, label, short] of [
  ["HOME", "Home win", "1"],
  ["DRAW", "Draw", "X"],
  ["AWAY", "Away win", "2"],
]) {
  add({
    id: `MATCH_RESULT_${sel}_REGULATION`,
    family: "MATCH_RESULT",
    category: "Match Result",
    settlement_period: REG.period,
    label: `Match result: ${label}`,
    short_label: short === "X" ? "Draw" : label,
    selection: sel,
    threshold: null,
    predicate: { type: "result", period: "FT", sides: [sel] },
    settlement_rules: REG.rule,
    exclusive_group: "MATCH_RESULT_REGULATION",
  });
}

// Double chance
for (const [sel, sides, label] of [
  ["HOME_DRAW", ["HOME", "DRAW"], "Home or draw (1X)"],
  ["DRAW_AWAY", ["DRAW", "AWAY"], "Draw or away (X2)"],
  ["HOME_AWAY", ["HOME", "AWAY"], "Home or away (12)"],
]) {
  add({
    id: `DOUBLE_CHANCE_${sel}_REGULATION`,
    family: "DOUBLE_CHANCE",
    category: "Match Result",
    settlement_period: REG.period,
    label: `Double chance: ${label}`,
    short_label: label,
    selection: sel,
    threshold: null,
    predicate: { type: "result", period: "FT", sides },
    settlement_rules: REG.rule,
  });
}

// Total goals
for (const t of [0.5, 1.5, 2.5, 3.5, 4.5]) {
  for (const dir of ["OVER", "UNDER"]) {
    add({
      id: `TOTAL_GOALS_${dir}_${fmt(t)}_REGULATION`,
      family: "TOTAL_GOALS",
      category: "Goals",
      settlement_period: REG.period,
      label: `Total goals: ${dir === "OVER" ? "Over" : "Under"} ${t}`,
      short_label: `${dir === "OVER" ? "Over" : "Under"} ${t} Goals`,
      selection: dir,
      threshold: t,
      predicate: { type: "total", stat: "goals", period: "FT", dir, threshold: t },
      settlement_rules: REG.rule + " Own goals count; goals in extra time do not.",
      exclusive_group: `TOTAL_GOALS_${fmt(t)}`,
    });
  }
}

// Both teams to score
for (const [sel, label] of [
  ["YES", "Yes"],
  ["NO", "No"],
]) {
  add({
    id: `BTTS_${sel}_REGULATION`,
    family: "BTTS",
    category: "Both Teams to Score",
    settlement_period: REG.period,
    label: `Both teams to score: ${label}`,
    short_label: `BTTS ${label}`,
    selection: sel,
    threshold: null,
    predicate: { type: "btts", period: "FT", value: sel === "YES" },
    settlement_rules: REG.rule + " Own goals count for the team credited with the goal.",
    exclusive_group: "BTTS",
  });
}

// Team goals
for (const side of ["HOME", "AWAY"]) {
  for (const t of [0.5, 1.5]) {
    add({
      id: `${side}_GOALS_OVER_${fmt(t)}_REGULATION`,
      family: "TEAM_GOALS",
      category: "Team Goals",
      settlement_period: REG.period,
      label: `${side === "HOME" ? "Home" : "Away"} team goals: Over ${t}`,
      short_label: `${side === "HOME" ? "Home" : "Away"} Over ${t}`,
      selection: `${side}_OVER`,
      threshold: t,
      predicate: { type: "team_total", stat: "goals", period: "FT", side, dir: "OVER", threshold: t },
      settlement_rules: REG.rule,
    });
  }
}

// Correct score (distribution derived from the same scoreline model)
for (let h = 0; h <= 3; h++) {
  for (let a = 0; a <= 3; a++) {
    add({
      id: `CORRECT_SCORE_${h}_${a}_REGULATION`,
      family: "CORRECT_SCORE",
      category: "Correct Score",
      settlement_period: REG.period,
      label: `Correct score: ${h}-${a}`,
      short_label: `${h}-${a}`,
      selection: `${h}_${a}`,
      threshold: null,
      predicate: { type: "correct_score", period: "FT", home: h, away: a },
      settlement_rules: REG.rule,
      exclusive_group: "CORRECT_SCORE",
    });
  }
}
add({
  id: "CORRECT_SCORE_OTHER_REGULATION",
  family: "CORRECT_SCORE",
  category: "Correct Score",
  settlement_period: REG.period,
  label: "Correct score: any other score (a side scores 4+)",
  short_label: "Other",
  selection: "OTHER",
  threshold: null,
  predicate: { type: "correct_score_other", period: "FT", max: 3 },
  settlement_rules: REG.rule,
  exclusive_group: "CORRECT_SCORE",
});

// First half
for (const [sel, label] of [
  ["HOME", "Home leads"],
  ["DRAW", "Level"],
  ["AWAY", "Away leads"],
]) {
  add({
    id: `FIRST_HALF_RESULT_${sel}`,
    family: "FIRST_HALF_RESULT",
    category: "First Half",
    tier: "B",
    model_family: "first_half_poisson",
    required_data: ["half_time_score"],
    settlement_period: FH.period,
    label: `First-half result: ${label}`,
    short_label: `HT ${label}`,
    selection: sel,
    threshold: null,
    predicate: { type: "result", period: "HT", sides: [sel] },
    settlement_rules: FH.rule,
    exclusive_group: "FIRST_HALF_RESULT",
  });
}
for (const t of [0.5, 1.5]) {
  for (const dir of ["OVER", "UNDER"]) {
    add({
      id: `FIRST_HALF_GOALS_${dir}_${fmt(t)}`,
      family: "FIRST_HALF_GOALS",
      category: "First Half",
      tier: "B",
      model_family: "first_half_poisson",
      required_data: ["half_time_score"],
      settlement_period: FH.period,
      label: `First-half goals: ${dir === "OVER" ? "Over" : "Under"} ${t}`,
      short_label: `HT ${dir === "OVER" ? "Over" : "Under"} ${t}`,
      selection: dir,
      threshold: t,
      predicate: { type: "total", stat: "goals", period: "HT", dir, threshold: t },
      settlement_rules: FH.rule,
      exclusive_group: `FIRST_HALF_GOALS_${fmt(t)}`,
    });
  }
}

// Corners
for (const t of [8.5, 9.5, 10.5]) {
  for (const dir of ["OVER", "UNDER"]) {
    add({
      id: `TOTAL_CORNERS_${dir}_${fmt(t)}_REGULATION`,
      family: "TOTAL_CORNERS",
      category: "Corners",
      tier: "B",
      model_family: "corners_negative_binomial",
      required_data: ["corner_counts"],
      settlement_period: REG.period,
      label: `Total corners: ${dir === "OVER" ? "Over" : "Under"} ${t}`,
      short_label: `${dir === "OVER" ? "Over" : "Under"} ${t} Corners`,
      selection: dir,
      threshold: t,
      predicate: { type: "total", stat: "corners", period: "FT", dir, threshold: t },
      settlement_rules:
        "Corners awarded in regulation time (90 minutes plus stoppage). Awarded-but-not-taken corners do not count. Operators' rules differ; check your operator's definition.",
      exclusive_group: `TOTAL_CORNERS_${fmt(t)}`,
    });
  }
}

// Yellow cards
for (const t of [3.5, 4.5]) {
  for (const dir of ["OVER", "UNDER"]) {
    add({
      id: `TOTAL_YELLOW_CARDS_${dir}_${fmt(t)}_REGULATION`,
      family: "TOTAL_YELLOW_CARDS",
      category: "Cards",
      tier: "B",
      model_family: "cards_negative_binomial",
      required_data: ["card_counts", "referee"],
      settlement_period: REG.period,
      label: `Yellow cards: ${dir === "OVER" ? "Over" : "Under"} ${t}`,
      short_label: `${dir === "OVER" ? "Over" : "Under"} ${t} Yellows`,
      selection: dir,
      threshold: t,
      predicate: { type: "total", stat: "yellow_cards", period: "FT", dir, threshold: t },
      settlement_rules:
        "Raw count of yellow cards shown to players in regulation time. This is NOT a booking-points market (where yellow=10, red=25). Cards to non-playing staff and cards after the final whistle are excluded. Operators' rules differ.",
      exclusive_group: `TOTAL_YELLOW_CARDS_${fmt(t)}`,
    });
  }
}

const catalog = {
  version: VERSION,
  generated_note: "Generated by scripts/build-market-catalog.mjs - do not edit by hand.",
  categories: [
    "Match Result",
    "Goals",
    "Both Teams to Score",
    "Team Goals",
    "Correct Score",
    "First Half",
    "Corners",
    "Cards",
  ],
  unsupported: [
    { family: "PLAYER_PROPS", reason: "Requires reliable confirmed line-ups, minutes and player event feeds (not available on the free data tier)." },
    { family: "REFEREE_SPECIALS", reason: "Requires verified referee assignment and sufficient referee history." },
    { family: "RED_CARDS_PENALTIES", reason: "Rare events; need hierarchical shrinkage models and much larger samples before publication." },
    { family: "BOOKING_POINTS", reason: "Different settlement definition from raw card counts; not yet modelled." },
    { family: "COMBINATIONS", reason: "Requires joint dependency simulation and validation; marginal probabilities must not be multiplied." },
    { family: "IN_PLAY", reason: "No live in-play modelling in phase one." },
  ],
  markets,
};

writeFileSync(new URL("../shared/market-catalog.json", import.meta.url), JSON.stringify(catalog, null, 2) + "\n");
console.log(`Wrote ${markets.length} market definitions (${VERSION}).`);
