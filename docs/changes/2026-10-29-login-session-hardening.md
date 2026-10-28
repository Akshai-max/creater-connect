# Login: hashed session cookie, no open app in production

**Date:** 2026-10-29
**Files:** `lib/session.ts` (new), `app/login/actions.ts`, `proxy.ts`, `tests/session.test.ts`

## Why
Three production problems in the sign-in:

1. **The cookie was the password.** `crm_auth` stored `APP_PASSWORD` in plain text, so anyone who saw the cookie (browser devtools, a proxy log, a shared machine) learned the password.
2. **No password meant an open app.** If `APP_PASSWORD` was missing on the server, every page, including leads, contacts and exports, was public.
3. **Open redirect.** `/login?next=//evil.com` redirected off-site after sign-in.

## What changed
- The cookie now holds `HMAC-SHA256(APP_PASSWORD, "creator-crm-session-v1")`. It's checked in constant time, and the password itself is never stored.
- The password check compares fixed-length digests, so it doesn't leak the password's length.
- In production (`NODE_ENV=production`) with no `APP_PASSWORD`, every non-public route returns **503 "APP_PASSWORD is not set"**, and login refuses. Local dev without a password stays open, as before.
- `next` is only followed when it's a same-site path (`/…`, not `//…` or `/\…`).
- `proxy.ts` uses the shared helper. It still runs on the Node.js runtime, which is the Next 16 default for proxy.

## What you'll notice
Everyone is signed out once, because old cookies held the plain password and no longer match. Sign in again. Changing `APP_PASSWORD` signs everyone out.

## Tests
`tests/session.test.ts`: the token isn't the password, an old plaintext cookie is rejected, a wrong password is rejected, and production without a password is refused.
