# Engine runs every 20 minutes

`npm run engine-cycle` ([scripts/engine-cycle.ts](../../scripts/engine-cycle.ts)) refreshes the next 30 channels from the YouTube Data API, then reruns the engine on `data/discovered-2026-10-29.csv` so every lead is requalified.

## Why a slice and not a full refresh

A full refresh of 275 channels cost 556 quota units and took 4m19s. Every 20 minutes that is about 40,000 units a day against a 10,000 daily quota. A 30-channel slice costs about 61 units and takes under a minute, so about 4,400 units a day, and the whole list is covered in 10 runs (about 3.3 hours).

## How it runs

- A Windows scheduled task named `creator-crm engine cycle` runs it every 20 minutes and appends output to `data/engine-cycle.log`.
- The cursor is in `data/engine-cycle-state.json` and only advances after a successful run, so a failed slice is retried.
- `data/engine-cycle.lock` stops two runs overlapping. A lock older than an hour is ignored.
- Rows a person has set by hand are not changed, because only activity, subscribers, country and language come from the refresh.

## Change or stop it

```
schtasks /change /tn "creator-crm engine cycle" /ri 30
schtasks /delete /tn "creator-crm engine cycle" /f
```

The slice size is `--slice <n>`. The input and id files are the two dated files under `data/`; update the defaults when you build a newer discovery file.

## Still true

Nothing qualifies yet (0 qualified, about 121 unverified, 154 rejected). A refresh keeps activity current but cannot supply need evidence, entity confirmation or contact routes. Those are manual research (see `docs/PILOT_RESULTS.md`).
