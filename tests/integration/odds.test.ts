/**
 * The Odds API integration: team matching on real provider names, market mapping, and the metered gateway keeping
 * the query-string key out of cache keys and stored snapshots. The provider is mocked; no credits are used.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestCtx } from "./harness.ts";
import { eventRows, matchEvent } from "../../worker/services/sports/odds.ts";
import { meteredGet } from "../../worker/services/sports/budget.ts";

const fx = (id: string, home: string, away: string, ko = "2026-10-21T19:00:00Z") => ({ id, starts_at_utc: ko, home, away, home_short: home, away_short: away });

describe("team matching", () => {
  const ours = [
    fx("a", "FC Internazionale Milano", "FK Shakhtar Donetsk"),
    fx("b", "FC Bayern München", "Arsenal FC"),
    fx("c", "Sporting Clube de Portugal", "LASK Linz"),
    fx("d", "Manchester City FC", "PAE AEK"),
    fx("e", "Paris Saint-Germain FC", "FC Barcelona"),
  ];
  it.each([
    ["Inter Milan", "Shakhtar Donetsk", "a"],
    ["Bayern Munich", "Arsenal", "b"],
    ["Sporting Lisbon", "LASK", "c"],
    ["Manchester City", "AEK Athens", "d"],
    ["Paris Saint Germain", "Barcelona", "e"],
  ])("%s vs %s", (home, away, id) => {
    expect(matchEvent({ commence_time: "2026-10-21T19:00:00Z", home_team: home, away_team: away }, ours)?.id).toBe(id);
  });
  it("never matches a different kickoff or an unrelated pair", () => {
    expect(matchEvent({ commence_time: "2026-10-25T19:00:00Z", home_team: "Inter Milan", away_team: "Shakhtar Donetsk" }, ours)).toBeNull();
    expect(matchEvent({ commence_time: "2026-10-21T19:00:00Z", home_team: "Celtic", away_team: "Rangers" }, ours)).toBeNull();
  });
});

describe("market mapping", () => {
  it("maps 3-way result and supported goal lines only", () => {
    const ev = {
      id: "x", commence_time: "2026-10-21T19:00:00Z", home_team: "Inter Milan", away_team: "Shakhtar Donetsk",
      bookmakers: [{ key: "pinnacle", title: "Pinnacle", last_update: "2026-10-21T10:00:00Z", markets: [
        { key: "h2h", outcomes: [{ name: "Inter Milan", price: 1.4 }, { name: "Draw", price: 4.8 }, { name: "Shakhtar Donetsk", price: 7.5 }] },
        { key: "totals", outcomes: [{ name: "Over", price: 1.9, point: 2.5 }, { name: "Under", price: 1.95, point: 2.5 }, { name: "Over", price: 1.5, point: 2.25 }] },
      ] }],
    };
    const rows = eventRows(ev, fx("a", "FC Internazionale Milano", "FK Shakhtar Donetsk"), "2026-10-21T10:05:00Z");
    expect(rows.map((r) => r[2]).sort()).toEqual(["MATCH_RESULT_AWAY_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_HOME_REGULATION", "TOTAL_GOALS_OVER_2_5_REGULATION", "TOTAL_GOALS_UNDER_2_5_REGULATION"]);
    expect(rows.find((r) => r[2] === "MATCH_RESULT_HOME_REGULATION")![4]).toBe(1.4);
    expect(rows.every((r) => r[3] === "Pinnacle" && r[8] === 0)).toBe(true);
  });
});

describe("gateway key handling", () => {
  let t: TestCtx;
  beforeAll(async () => { t = await createTestEnv({ seed: false, vars: { ODDS_API_KEY: "secret-test-key" } }); });
  afterAll(async () => { await t?.dispose(); });

  it("sends the key in the URL but never stores it", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: string) => { seenUrl = url; return new Response("[]", { status: 200, headers: { "x-requests-remaining": "480" } }); }) as unknown as typeof fetch;
    await meteredGet(t.env, "/sports/soccer_epl/odds", { regions: "eu", markets: "h2h" }, { ttlSec: 0, provider: "the_odds_api", fetchImpl });
    expect(seenUrl).toContain("apiKey=secret-test-key");
    const snap = await t.env.DB.prepare("SELECT params_key, body_json FROM provider_snapshots WHERE provider = 'the_odds_api'").first<{ params_key: string; body_json: string }>();
    expect(snap!.params_key).not.toContain("secret-test-key");
    const usage = await t.env.DB.prepare("SELECT params_key FROM provider_api_usage WHERE provider = 'the_odds_api'").first<{ params_key: string }>();
    expect(usage!.params_key).not.toContain("secret-test-key");
  });
});
