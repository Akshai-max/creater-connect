# Lead detail page: cleaner layout

**Date:** 2026-10-29
**Files:**
- `app/leads/[id]/page.tsx`
- `app/leads/[id]/message-tabs.tsx`
- `app/leads/[id]/lead-actions.tsx`

## Why
The lead page read like a debug dump:
- Raw ids at the top (`L-E02BFD0878 · youtube:UC_…`).
- Lowercase tags like "qualified" and "youtuber".
- Messages in a monospace box cut off by its scrollbar.
- Full URLs printed under every draft and evidence row.
- The contact reasoning as one long paragraph.

## What changed
- **Header:**
  - The name sits on the same line as Qualified / Priority A.
  - A plain subtitle follows, such as "YouTube · US · English", then "View on YouTube ↗".
  - The lead id is small and grey underneath, with the platform id on hover.
  - Actions are real buttons: "Add to pipeline", plus "Export drafts" (or "Draft messages" when none exist).
- **Key numbers:** five tiles: lead score, audience, uploads in 30 days, long-form in 60 days, last upload. They replace the Activity card.
- **Not-qualified reason:** an amber alert with an icon, headed "Why this lead isn't qualified".
- **Outreach drafts:**
  - The channels are a segmented control: Email / LinkedIn / Instagram, each showing "x/3 approved" or "Not available".
  - The steps are a numbered timeline (First message, Follow-up 1, Follow-up 2). An approved step turns green with a check.
  - The Subject and Message fields are labelled and use the normal font. The message box grows to fit the text (up to 16 lines) and can be resized.
  - Evidence shows as a small "Based on youtube.com ↗" chip instead of a full URL.
  - Approve and Save are one button. It reads "Save changes" when you've edited the text and "Approve" when you haven't, and shows "Unsaved changes" next to it while you're editing.
  - The personalization hook is shown above the drafts.
- **Evidence:**
  - Grouped under headings: Profile, Who runs the channel, Country, Monetization, Need, Contact routes, Recent content.
  - Each row shows its text, its date, a Long-form tag where it applies, and a "youtube.com ↗" link.
  - AI-sourced rows carry an "AI · check it" tag.
- **Qualification:** an "x/y passed" count with a progress bar. Failing checks are listed first with icons (red for reject, amber for unverified).
- **How to reach them:**
  - The best and backup routes are shown as two small boxes, with the verification status as a badge.
  - The long reasoning and the unavailable channels are folded under "Why this route".
- **Score breakdown:** the bars are thinner. Each factor's reason appears when you hover over its bar.

Display only: no change to data, actions, the approval rules, or what gets exported.

## Checks
`npx tsc --noEmit` is clean.
