# Business emails from creators' own websites

**Date:** 2026-10-29
**Files:**
- `lib/leads/website-contacts.ts` (new)
- `scripts/find-contacts.ts` (new)
- `tests/website-contacts.test.ts` (new)
- `scripts/engine-cycle.ts`
- `package.json`

## Why
Of the 592 channels added this afternoon, only 1 qualified. 558 of them had no verified business contact. The CRM only looked for emails on YouTube itself and in podcast RSS feeds, but most creators publish their business email on their own website or link-in-bio page.

## What it does
For each lead without an email (`npm run find-contacts`, and up to 25 per 20-minute cycle):

1. **Reads the creator's latest video descriptions.** It reads the 15 newest, costing 1 YouTube unit.
2. **Collects the links the creator shares** in those descriptions and in the channel description.
3. **Visits only the creator's own sites:**
   - sites linked from the channel description;
   - link-in-bio pages (Linktree, Beacons, Stan, Carrd and others);
   - sites whose domain contains a distinctive word of the creator's name.

   It skips sponsors, guests, shops, platforms and URL shorteners. From a link page it follows only the link labelled as the creator's website or contact, or one whose domain carries their name.
4. **Reads the home page plus up to 3 same-site contact, about or work-with-me pages.** It looks for emails in the visible text and in `mailto:` links.
5. **Picks the best email.** It prefers business context ("business / sponsorship / partnerships / booking / press / contact" on the same line, or a /contact-type page), then the site's own domain, then a mailto link.

### Rules kept
- **robots.txt is honoured for every host**, including after redirects (RFC 9309: 4xx means no rules, 5xx or unreachable means stay away).
- **Fetch limits:**
  - 8 s timeout, 1.5 MB cap, HTML only;
  - at most 3 sites and about 4 pages per site;
  - 1 second between hits to the same host;
  - user agent `creator-crm-contact-finder/1.0`.
- **Only published emails are used:**
  - Never guessed patterns (name@domain), and no third-party email finders.
  - Obfuscated addresses (Cloudflare email protection) aren't decoded.
  - Platform addresses (pr@patreon.com, help@linktr.ee), no-reply and privacy addresses, and tracking addresses are dropped.
  - A redirect onto a platform stops the lookup.
- **An existing email is never overwritten.** The columns follow the podcast-feed email:
  - `email_source = published`, with the page URL as evidence;
  - `email_business_use = yes` only when the page says so;
  - `email_last_active` = the newest video whose description links the site. A site linked only from the channel description gets no date, plus a CONFIRM note.
- **Every found email adds a `CHECK:` review note** naming the page.
- **Each lead is looked up once a month** (`data/contact-finder-cache.json`). Leads already rejected for other reasons are skipped.

## In the cycle
`engine-cycle` runs it after the entity check and before the refresh:
- `--contacts-limit 25` sets how many leads it checks per cycle; `--no-contacts` turns it off.
- Its YouTube units count in the run's API units.
- The backlog of about 320 leads clears in about 13 cycles, after that only new leads are looked up.
- That's about 1 unit per new lead, a few hundred a day. Together with discovery (≤ 7,000) and the refresh (about 1,500), that stays under 10,000.

## Results (real run, 2026-10-29)
- **Dry run, 20 leads:** 8 emails found with the first version. One was a sponsor's shop address (`orders@…`) linked in video descriptions. That's why sites now have to be the creator's own; the same 20 leads then gave 4.
- **Real run, 50 leads:** 10 emails found, 8 marked business, all with an activity date.
  - One was `pr@patreon.com`, reached by a redirect. It was removed from the file and its cache entry cleared, and redirects onto platforms and platform addresses are now blocked (tested).
- **Engine re-run:** qualified and Priority A went from **6 to 10**: Into the Weeds Podcast, Gym Business Coach Podcast, Thais Gibson (Personal Development School), RHAP.
- **The other 5 with emails are still unverified:**
  - 3 have an email that isn't marked for business, or a contact check that doesn't pass yet;
  - 2 are missing monetization evidence.
- **23 of 50 leads link no site of their own at all.** For those, contact still has to come from somewhere else.

## Checks
- `npx tsc --noEmit` is clean.
- `npm test`: 104/104 pass, 11 of them new.
- The new tests cover:
  - robots.txt groups, wildcards and the 5xx rule;
  - redirects checked per host;
  - sponsors linked in videos ignored;
  - platform addresses dropped;
  - mailto and visible emails, with business context taken from the same line only;
  - never overwriting an existing email.
