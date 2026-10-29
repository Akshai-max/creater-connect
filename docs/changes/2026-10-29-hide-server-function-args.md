# Stop logging Server Function arguments (passwords in the dev log)

**Date:** 2026-10-29
**Files:** `next.config.ts`

## Why
Next.js 16 logs every Server Function call in development, **with its arguments**:

```
POST /login?next=…
  └─ ƒ login("<the typed password>", "/leads?tab=all") in 8ms app/login/actions.ts
```

The login form passes the password to the `login` Server Function, so every sign-in attempt, wrong or right, was printed in plain text to the dev server's terminal and log. Other Server Functions do the same with creator emails, message bodies and review notes. Anyone who could see the terminal, a shared screen, a recording (such as the demo videos) or a copied log could read them.

This was found on 2026-10-29, while checking the leads pagination in the dev server log.

## What changed
`logging.serverFunctions: false` in `next.config.ts`, as documented in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/logging.md`. Page and API requests are still logged, without the Server Function names and arguments.

## What you should do
- **Your password appeared in this machine's dev log** before the fix. Change `APP_PASSWORD` if the log may have been seen or saved. Changing it signs everyone out.
- Don't record demo videos with an older terminal log on screen.

## Checks
Needs a dev server restart, which was done. The next sign-in should show only `POST /login …` with no `ƒ login(…)` line.
