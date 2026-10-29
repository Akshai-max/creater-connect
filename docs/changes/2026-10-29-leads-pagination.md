# Leads page: database pagination

**Date:** 2026-10-29
**Files:** `app/leads/page.tsx`

## Why
The Leads page rendered slowly and got worse as discovery added leads. On every request it:
- loaded **every lead with every column**, including the large JSON fields (qualification checks, score factors);
- counted, filtered and sorted them in JavaScript;
- rendered up to 300 table rows at once.

With 284 real leads, that was **4.3 MB** of data per page load. At the 1,000–5,000 leads the brief targets, it would only grow.

## What changed
- **Counts** (Qualified / Unverified / Rejected / Priority A / fixtures) come from `count(*)` and `GROUP BY` queries instead of loading rows.
- **The table** loads only the 14 columns it shows, **50 rows per page**, with `LIMIT`/`OFFSET`. Sorting stays the same (score high to low, then lead id), but now runs in Postgres, with `NULLS LAST` so unscored leads go to the end.
- **The validation report** is built from qualified leads only, since `buildExport` only reports on those. The result is unchanged.
- **Pager** under the table:
  - "1–50 of 284";
  - Previous / Next buttons;
  - page numbers (first, last, and two either side of the current page, with "…" for gaps).
  - The page is part of the URL, `/leads?tab=all&page=3`, so it survives reloads and can be shared.
  - Switching tabs goes back to page 1, and an out-of-range `?page=` is clamped to the last page.
- The old "Showing the top 300" note is gone: every lead can be reached by paging.

## Result
Measured against the real database (284 leads):

| | Before | After |
|---|---|---|
| Lead data loaded per request | 4,279 KB (all rows, all columns) | 35 KB (50 rows, 14 columns) |
| Rows rendered | up to 300 | 50 |
| Leads you can reach in the UI | top 300 | all, 6 pages of 50 |

The status counts (128 unverified, 156 rejected) and page order (page 2 runs from score 74.6 to 65.9) match the database.

## Checks
TypeScript clean. The queries were checked directly against the database. The browser check needs a signed-in session.
