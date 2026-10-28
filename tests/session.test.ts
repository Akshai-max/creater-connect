import { test } from "node:test"
import assert from "node:assert/strict"
import { isValidSession, passwordMatches, passwordMissingInProduction, sessionToken } from "../lib/session"

test("the session cookie is an HMAC of the password, never the password", () => {
  const t = sessionToken("correct horse")
  assert.match(t, /^[0-9a-f]{64}$/)
  assert.ok(!t.includes("correct horse"))
  assert.equal(t, sessionToken("correct horse"))
  assert.notEqual(t, sessionToken("correct horsf"))
})

test("sessions and passwords are checked exactly", () => {
  assert.ok(isValidSession(sessionToken("pw-1"), "pw-1"))
  assert.ok(!isValidSession("pw-1", "pw-1")) // an old plaintext cookie no longer works
  assert.ok(!isValidSession(undefined, "pw-1"))
  assert.ok(!isValidSession(sessionToken("pw-1"), "pw-2")) // changing the password signs everyone out
  assert.ok(passwordMatches("pw-1", "pw-1"))
  assert.ok(!passwordMatches("pw-", "pw-1"))
})

test("production refuses to run without a password; dev stays open", () => {
  assert.equal(passwordMissingInProduction({ NODE_ENV: "production" }), true)
  assert.equal(passwordMissingInProduction({ NODE_ENV: "production", APP_PASSWORD: "x" }), false)
  assert.equal(passwordMissingInProduction({ NODE_ENV: "development" }), false)
})

test("check-env flags blocking and risky production settings by name", async () => {
  const { checkEnv } = await import("../lib/env-check")
  const keys = (env: Record<string, string>) => checkEnv(env).map((f) => `${f.level}:${f.key}`)
  const bare = keys({})
  for (const k of ["error:DATABASE_URL", "error:APP_PASSWORD", "error:SENDER_NAME", "warn:CRON_SECRET", "warn:APP_BASE_URL"]) assert.ok(bare.includes(k), k)
  const good = {
    DATABASE_URL: "postgres://x", APP_PASSWORD: "a-long-password-123", SENDER_NAME: "A", SENDER_ROLE: "B", SENDER_COMPANY: "C", SENDER_POSTAL_ADDRESS: "D",
    CRON_SECRET: "x".repeat(32), ENGINE_WEBHOOK_SECRET: "y".repeat(32), AGENT_WEBHOOK_SECRET: "z".repeat(32), YOUTUBE_API_KEY: "k",
    APP_BASE_URL: "https://crm.example.com", SEED_TEST_ALLOWLIST: "email:me@example.com", AGENT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k",
  }
  assert.deepEqual(checkEnv(good), [])
  assert.ok(keys({ ...good, OUTREACH_MODE: "live" }).includes("warn:OUTREACH_MODE"))
})
