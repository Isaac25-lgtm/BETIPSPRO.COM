/**
 * Brand configuration - the ONLY place the public product name lives.
 *
 * "BetTipsPro" is a VISUAL PLACEHOLDER taken from the owner's reference brief.
 * It is NOT an approved name. Motion Imprints Technologies is the company owner,
 * not the product brand. Change publicName/wordmark here and every surface updates.
 */
export const brand = {
  publicName: "BetTipsPro",
  /** Wordmark split: first part renders white, accent part renders green. */
  wordmark: { base: "BetTips", accent: "Pro" },
  tagLine: "Analyse smarter. Understand the evidence.",
  companyOwner: "Motion Imprints Technologies",
  primary: "#1df992",
  deepNavy: "#001424",
  faviconPath: "/brand/favicon.svg",
  logoPath: "/brand/brand-mark.svg",
  placeholder: true,
} as const;

export type Brand = typeof brand;
