# Visual QA checklist

Reference: `design/reference/homepage-reference.png` (1536 × 1024). Capture: `node scripts/screenshots.mjs` → `artifacts/visual-review/`; overflow + touch-target assertions: `npx playwright test tests/e2e/visual.spec.ts` (10 viewports × 10 pages).

| Element | Reference | Implementation | Status |
|---|---|---|---|
| Navbar | 74px navy, logo + tagline left, centred links with green active underline, search, outline Login, green Get Started | Same geometry/colours (#001424, #1df992) | ✅ |
| Hero | 398px, 2-line 70px+ headline with green phrase, 2-line lede, green CTA, players right | Same layout; original stadium/ball art replaces player photo (rights) | ✅ (art differs by design) |
| Feature strip | 4 circular icons with separators along hero bottom | Same; labels made non-advisory | ✅ |
| Content grid | ~977 / 17 / 416, off-white page | `minmax(0,1fr) 416px`, gap 17 | ✅ |
| Fixture card | Flame title, date, View all, 6-column table, badges, odds pills, green bars | Same structure; monogram badges, synthetic label, "Featured market" | ✅ |
| Premium card | Dark green, crown, 5 checks, green CTA, ball-in-net art | Same; beta copy | ✅ |
| Performance card | Chart icon, 3 big green KPIs | Same layout; truthful KPIs (0 / Pending / In review) | ✅ |
| League tiles | 3 image tiles with icon, title, text, outline CTA | Same; no league logos | ✅ |
| Mobile | not desktop squashed | Art-directed hero crop, 2×2 features, stacked match cards, bottom tab bar, sticky match tabs | ✅ |

Permitted deviations: rights-sensitive media replaced, compliant copy, truthful performance, demo labelling, responsive adaptations.
