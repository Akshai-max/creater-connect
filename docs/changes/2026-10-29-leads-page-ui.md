# Leads page UI

Changed [app/leads/page.tsx](../../app/leads/page.tsx) only. No database or engine changes.

- **Table:** the Creator line no longer repeats the platform ("youtuber · youtube"), the segment shows only when it differs from the platform, and followers are labelled. Activity reads "29 / 30d · 50 long-form / 60d". The Reason column is replaced by **Why**, shown only on the Unverified, Rejected and All tabs, with the first reason, a "+N more" count and the full list on hover. On Qualified and Priority A it is hidden because it was always empty.
- **Search, filter, sort:** a name or lead id search, a country filter, and sortable Creator, Score and Activity headers. All of it is a plain GET form and links, so it works without client JavaScript and keeps the URL shareable. The existing paging and fixtures toggle keep their state.
- **Tabs:** a segmented control with a count on every tab. The summary cards link to their tab.
- **Dataset validation:** one pass/fail summary badge, a checklist with failing checks first, and a country share bar. The "Export problems" card turns red when there are any.

## Not verified visually

The page needs the app login, which I did not enter. Typecheck is clean.
