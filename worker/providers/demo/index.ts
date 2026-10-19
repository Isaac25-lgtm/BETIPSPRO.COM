/**
 * Demo provider: serves the SYNTHETIC records already imported from fixtures/demo. It never makes
 * network calls and costs zero provider quota. Used when SPORTS_PROVIDER != api_football or no key.
 */
import type { Env } from "../../env.ts";
import type { FixtureBundle, SportsDataProvider } from "../types.ts";

export class DemoFixtureProvider implements SportsDataProvider {
  readonly name = "demo";
  private env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  async listFixtures(input: { date?: string; league?: string }): Promise<FixtureBundle> {
    const rows = await this.env.DB.prepare(
      `SELECT * FROM fixtures WHERE is_synthetic = 1 AND (?1 IS NULL OR substr(starts_at_utc, 1, 10) = ?1) AND (?2 IS NULL OR competition_id = ?2) ORDER BY starts_at_utc LIMIT 200`,
    )
      .bind(input.date ?? null, input.league ?? null)
      .all();
    return { competitions: [], teams: [], fixtures: rows.results as never[], stats: [] };
  }

  async getFixtures(ids: string[]): Promise<FixtureBundle> {
    const rows = await this.env.DB.prepare("SELECT * FROM fixtures WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all();
    return { competitions: [], teams: [], fixtures: rows.results as never[], stats: [] };
  }
}
