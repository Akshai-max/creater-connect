# Cycle runs hidden; contact finder hang fixed; killed cycles can't block the next one

**Date:** 2026-10-30
**Files:** `scripts/run-cycle-hidden.vbs` (new), `scripts/engine-cycle.ts`, `scripts/find-contacts.ts`, `lib/leads/website-contacts.ts`, `tests/website-contacts.test.ts`, and the "creator-crm engine cycle" scheduled task (machine setting, not in git)

## What you saw
A black `npm run engine-cycle` window opened on screen and stayed for minutes. Three separate problems were behind it.

### 1. The scheduled task ran in a visible window
The task started `cmd /c npm run engine-cycle`, which opens a console window for the whole cycle. With 500-channel discovery steps a cycle takes 10 to 15 minutes, so the window was nearly always up.
- New `scripts/run-cycle-hidden.vbs` starts the same command with the window hidden. Output still goes to `data/engine-cycle.log`.
- The scheduled task now runs `wscript.exe //B //Nologo scripts\run-cycle-hidden.vbs`. This was changed on this machine with `Set-ScheduledTask`; it is not stored in git. If the task is ever recreated, point it at the .vbs.
- Checked: a cycle started through the task ran with a `wscript` process and no visible console window.

### 2. A page made the contact finder run forever
The contacts step spent 21 minutes at 90% of a CPU core with no network activity and saved nothing. The page was a 1.5 MB site that is mostly one long run of letters. The email pattern `[A-Za-z0-9._%+-]+@…` re-reads that whole run from every starting point, which takes quadratic time. Because the lead was never marked as looked up, every cycle would have hit it again.
- Emails are now found by growing outward from each `@` (at most 64 characters left, 255 right). It stays linear in the page size. A test feeds a 1.4 MB page and requires the result in under 2 seconds.
- The text used to decide "this is a business email" is now limited to about 150 characters around the address. Before, a minified page that is one huge line could mark a fan-mail address as business because a sponsorship line sat somewhere on the page. A test covers this.
- New `--max-minutes` (default 6): the contact step stops after 6 minutes and the rest are done next cycle. The cycle also kills the step after 12 minutes as a backstop. New `--verbose` prints each lead as it starts.
- The same 25 leads that hung now take 45 seconds and find 4 business emails.

### 3. A killed cycle left its lock behind
Closing the window (or Ctrl+C) kills the cycle, and a killed process never removes `data/engine-cycle.lock`. The lock then blocked every cycle for up to an hour ("previous run still going, skipping"), which also made my first hidden-launcher test misleading.
- The lock file holds the cycle's process id, and a lock counts only while that process is still running. A leftover lock from a killed cycle is ignored. The one-hour age limit stays as an extra guard.

## Checks
- `npx tsc --noEmit` clean; `npm test`: 105/105 pass (one new test for the huge page).
- The interrupted cycle finished after the stuck step was stopped: 2,048 leads, 18 qualified (12 before).

## Notes
- The first cycle hit the hang at 04:50; the stuck contacts step was stopped by hand at about 05:12, and the lock was removed by hand once at 04:46 (the pid check now does that on its own).
- Closing a window is no longer something you can do by accident: there is none.
