import { describe, expect, it } from "vitest";
import { catalog, marketById, settle } from "../../shared/markets.ts";
import { eatDayBounds, todayEat } from "../../worker/lib/time.ts";
import { hashPassword, verifyPassword, timingSafeEqual, inviteCode } from "../../worker/lib/crypto.ts";
import { allowedNumbers, validateSummary } from "../../worker/services/ai/validate.ts";
import { normalizeFixtures } from "../../worker/providers/api-football/index.ts";
import { paramsKey } from "../../worker/services/sports/budget.ts";
import { shiftArtifact } from "../../worker/services/importer.ts";

describe("market catalogue", () => {
  it("has 56 markets with unique ids and settlement rules", () => {
    expect(catalog.markets).toHaveLength(56);
    expect(new Set(catalog.markets.map((m) => m.id)).size).toBe(56);
    for (const m of catalog.markets) expect(m.settlement_rules.length).toBeGreaterThan(20);
  });
  it("settles predicates identically to the Python pipeline cases", () => {
    const o = { hg: 2, ag: 1, hth: 0, ath: 1, corners_total: 10, yellow_total: 3 };
    const s = (id: string) => settle(marketById.get(id)!.predicate, o);
    expect(s("MATCH_RESULT_HOME_REGULATION")).toBe(1);
    expect(s("FIRST_HALF_RESULT_AWAY")).toBe(1);
    expect(s("TOTAL_GOALS_OVER_2_5_REGULATION")).toBe(1);
    expect(s("BTTS_YES_REGULATION")).toBe(1);
    expect(s("TOTAL_CORNERS_OVER_9_5_REGULATION")).toBe(1);
    expect(s("TOTAL_YELLOW_CARDS_UNDER_3_5_REGULATION")).toBe(1);
    expect(s("CORRECT_SCORE_2_1_REGULATION")).toBe(1);
    expect(s("CORRECT_SCORE_OTHER_REGULATION")).toBe(0);
    expect(settle(marketById.get("TOTAL_CORNERS_OVER_9_5_REGULATION")!.predicate, { ...o, corners_total: null })).toBeNull();
  });
});

describe("time (EAT presentation)", () => {
  it("maps an EAT calendar day to UTC bounds", () => {
    expect(eatDayBounds("2026-10-20")).toEqual({ start: "2026-10-19T21:00:00.000Z", end: "2026-10-20T21:00:00.000Z" });
    expect(todayEat(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-20");
  });
});

describe("crypto", () => {
  it("hashes and verifies passwords; rejects wrong ones", async () => {
    const h = await hashPassword("CorrectHorse123");
    expect(h.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("CorrectHorse123", h)).toBe(true);
    expect(await verifyPassword("WrongHorse123", h)).toBe(false);
  });
  it("timing-safe compare and invite code format", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(inviteCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe("AI guardrails", () => {
  const evidence = { forecast: { probability: 0.206 }, sets: [{ hits: 6, settled: 8, rate: 0.75 }], league: { rate: 0.433 } };
  it("accepts summaries whose numbers reconcile with evidence", () => {
    const v = validateSummary("The model estimates 21% while 6 of 8 recent home matches (75%) went under; league rate 43%.", allowedNumbers(evidence));
    expect(v.ok).toBe(true);
  });
  it("rejects betting slang but not ordinary words that contain it", () => {
    const allowed = allowedNumbers(evidence);
    expect(validateSummary("A good chance of hitting the over.", allowed).ok).toBe(false);
    expect(validateSummary("Punters may like the under here.", allowed).ok).toBe(false);
    expect(validateSummary("Small stake, value bet.", allowed).ok).toBe(false);
    expect(validateSummary("The overall picture is mixed; one defensive mistake changed the outcome.", allowed).ok).toBe(true);
  });
  it("rejects invented numbers, certainty language and tactical claims", () => {
    expect(validateSummary("Expect 68% win rate.", allowedNumbers(evidence)).ok).toBe(false);
    expect(validateSummary("This is a guaranteed lock.", allowedNumbers(evidence)).ok).toBe(false);
    expect(validateSummary("Their high pressing will dominate.", allowedNumbers(evidence)).ok).toBe(false);
  });
});

describe("API-Football normalisation", () => {
  const item = {
    fixture: { id: 1035037, referee: "M. Oliver, England", date: "2023-08-11T19:00:00+00:00", status: { short: "FT" }, venue: { name: "Turf Moor", city: "Burnley" } },
    league: { id: 39, name: "Premier League", country: "England", season: 2023, round: "Regular Season - 1" },
    teams: { home: { id: 44, name: "Burnley" }, away: { id: 50, name: "Manchester City" } },
    goals: { home: 0, away: 3 },
    score: { halftime: { home: 0, away: 2 }, fulltime: { home: 0, away: 3 } },
    statistics: [
      { team: { id: 44 }, statistics: [{ type: "Corner Kicks", value: 6 }, { type: "Yellow Cards", value: 2 }, { type: "Ball Possession", value: "35%" }] },
      { team: { id: 50 }, statistics: [{ type: "Corner Kicks", value: 7 }, { type: "Yellow Cards", value: null }] },
    ],
  };
  it("maps the documented envelope to provider-neutral records with provenance ids", () => {
    // Shape-only test input: illustrates field mapping; not stored or displayed.
    const b = normalizeFixtures([item as never], "2026-10-20T00:00:00Z");
    expect(b.fixtures[0]).toMatchObject({ id: "apif:fx:1035037", competition_id: "apif:39", status: "FT", home_goals: 0, away_goals: 3, home_goals_ht: 0, away_goals_ht: 2, referee_name: "M. Oliver", starts_at_utc: "2023-08-11T19:00:00Z", is_synthetic: 0 });
    expect(b.stats).toHaveLength(2);
    expect(b.stats[0]).toMatchObject({ corners: 6, yellow_cards: 2, possession_pct: 35 });
    expect(b.stats[1].yellow_cards).toBeNull();
  });
  it("builds stable cache keys independent of parameter order", () => {
    expect(paramsKey({ b: 2, a: "x", c: undefined })).toBe(paramsKey({ a: "x", b: 2 }));
  });
});

describe("demo re-anchoring", () => {
  it("shifts every ISO timestamp uniformly and nothing else", () => {
    const out = shiftArtifact({ a: "2026-10-20T13:30:00Z", b: ["2026-10-19T00:00:00Z", "not a date"], c: 5 }, 86_400_000);
    expect(out).toEqual({ a: "2026-10-21T13:30:00Z", b: ["2026-10-20T00:00:00Z", "not a date"], c: 5 });
  });
});
