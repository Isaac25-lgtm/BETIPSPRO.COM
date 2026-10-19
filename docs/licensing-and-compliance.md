# Licensing, data rights & compliance (status: OPEN, needs qualified review)

This is an engineering record of known gates, not legal advice.

## Data rights
| Item | Status | Action needed |
|---|---|---|
| API-Football data in a **paid** report product | **Unconfirmed.** Their terms state a subscription does not by itself grant rights to publish all data/logos/images publicly, betting-related use may need rights-holder permission, and raw feed resale is prohibited. | Read https://www.api-football.com/terms in full; email API-SPORTS describing the exact product (paid per-match research reports for adults in Uganda, no raw downloads); seek rights-holder guidance for the leagues targeted. |
| Club crests, league emblems, player photos | **Not used.** Monogram badges and original procedural art only. | Licence any imagery before use. |
| Competition names | Used descriptively. | Confirm in legal review. |
| Bookmaker prices | Only if the provider supplies them; no scraping; betPawa not assumed. | Confirm display rights for odds. |
| Reference screenshot | Kept local, gitignored by default. | Owner decides whether it may be committed. |
| Sofascore | Functional UX reference only; no assets, code or content copied. | — |

## Uganda regulatory
- Classification of a **paid odds/analysis service** under Ugandan gaming law is **not determined**. Obtain a qualified opinion; review NLGRB advertising guidelines (https://lgrb.go.ug/download/nlgrb-advertising-guidelines/).
- Consumer protection, data protection (Uganda Data Protection and Privacy Act 2019) and payment regulations need review before collecting money or personal data beyond the closed beta.

## Built-in safeguards
- 18+ confirmation and privacy consent at sign-up (self-attestation only, not age verification).
- No certainty/"guaranteed"/"sure odds" language; AI output filtered for such language and unverifiable numbers.
- No ROI or win-rate claims; performance shown only as verified, timestamped forecasts.
- Responsible-use page, footer notice, no urgency/inducement mechanics, no promotional messaging.
- Legal pages are labelled **draft** in the UI.

## Blockers for public / paid launch
See `release-checklist.md`: data-rights confirmation, regulatory classification, reviewed privacy/terms/refund policies, approved payment provider with signed webhooks, final brand/trademark check.
