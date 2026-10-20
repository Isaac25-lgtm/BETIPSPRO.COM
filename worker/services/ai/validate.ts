/**
 * Post-generation guardrails for optional LLM summaries. A summary is accepted ONLY if:
 *  - it parses as the required JSON shape,
 *  - every number it contains is reconcilable with the verified evidence it was given,
 *  - it contains no prohibited certainty / inducement language,
 *  - it makes no tactical claims the evidence does not support.
 * Otherwise the caller falls back to the deterministic template.
 */
export const BANNED = [
  /guarantee/i, /sure (win|bet|odds|thing)/i, /fixed match/i, /risk[- ]free/i, /\block\b/i, /banker/i, /can'?t lose/i,
  /must bet/i, /bet now/i, /easy money/i, /hit(?:s|ting)? the (?:over|under)/i, /value bet/i, /\bthe (?:over|under)\b(?!all)/i, /\bpunt(?:s|ers?)?\b/i, /\bstakes?\b/i, /profit(able)? (tip|guaranteed)/i, /100% (win|certain)/i, /certain(ly)? (win|happen)/i,
];
const TACTICAL = [/pressing/i, /formation/i, /overlap/i, /high line/i, /counter[- ]attack/i, /possession-based/i, /set[- ]piece routine/i];

export function allowedNumbers(evidence: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(String(n));
    out.add(n.toFixed(0));
    out.add(n.toFixed(1));
    out.add(n.toFixed(2));
    if (n >= 0 && n <= 1) {
      const p = n * 100;
      out.add(p.toFixed(0));
      out.add(p.toFixed(1));
    }
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(evidence);
  for (let i = 0; i <= 10; i++) out.add(String(i)); // small cardinal words-as-digits are harmless
  return out;
}

export interface Validation {
  ok: boolean;
  problems: string[];
}

export function validateSummary(text: string, allowed: Set<string>, evidenceMentionsTactics = false): Validation {
  const problems: string[] = [];
  for (const re of BANNED) if (re.test(text)) problems.push(`prohibited language: ${re}`);
  if (!evidenceMentionsTactics) for (const re of TACTICAL) if (re.test(text)) problems.push(`unsupported tactical claim: ${re}`);
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const tok = m[0];
    const n = Number(tok);
    const variants = [tok, n.toFixed(0), n.toFixed(1), n.toFixed(2)];
    if (!variants.some((v) => allowed.has(v))) problems.push(`unreconciled number: ${tok}`);
  }
  return { ok: problems.length === 0, problems };
}
