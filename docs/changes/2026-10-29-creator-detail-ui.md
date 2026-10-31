# Creator detail page UI

Changed [app/creators/[id]/page.tsx](../../app/creators/[id]/page.tsx) and [task-form.tsx](../../app/creators/[id]/task-form.tsx). Display only.

- **Tasks:** the Add button stuck out past the card edge. The task input had no `min-w-0`, so it wouldn't shrink; the input now shrinks and the select and button keep their size.
- **Qualification evidence:** long URLs wrapped into broken lines. Each row is now a label and one truncated link (`youtube.com/watch?v=…`, full URL on hover).
- **Profile:** empty fields no longer show as a grid of dashes. Set fields show, and the rest are listed on one "Not set:" line.
- **Contact:** removed the second avatar and name, which repeated the header.

Not changed: this lead's four evidence links all point at the same video. That is the data, not the layout.
