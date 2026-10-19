export const nowIso = () => new Date().toISOString();
export const EAT_OFFSET_MIN = 180; // Uganda (East Africa Time), UTC+3, no DST

/** UTC [start, end) ISO bounds for a calendar date in EAT. */
export function eatDayBounds(dateYmd: string): { start: string; end: string } {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - EAT_OFFSET_MIN * 60_000);
  const end = new Date(start.getTime() + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function todayEat(now = new Date()): string {
  return new Date(now.getTime() + EAT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const minuteBucket = (d = new Date()) => d.toISOString().slice(0, 16);
