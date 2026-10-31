# Creator detail page: friendlier layout

[app/creators/[id]/page.tsx](../../app/creators/[id]/page.tsx) only. Display only; no data changes.

- **Header:** the status and Priority A badges moved up next to the name, the lead id is small and muted, and **Compose pitch** is now the primary button beside the pipeline stage instead of at the bottom of Contact.
- **Stat strip:** followers, country, lead score (with best channel) and recent activity, so the key facts are visible without scrolling.
- **Notes & timeline:** the note box and the activity timeline are one card, with the note form on top.
- **Secondary info:** Profile details, Commercials and Meta are collapsible cards under the timeline. Each shows a short hint when closed.
- **Right column order:** Contact, Tasks, then **Why they qualify**.
- **Why they qualify:** evidence rows that point at the same page are shown once with all their labels (Recent content, Monetization, Need, Channel), as a link with an external-link icon. When one page supports everything, it says so.
- **Contact:** with no email or phone it says to use DM and names the lead's best channel.
