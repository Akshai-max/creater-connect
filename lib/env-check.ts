// Production readiness check for environment variables. Reports names only, never values.
type Env = Record<string, string | undefined>
export type EnvFinding = { level: "error" | "warn"; key: string; message: string }

const has = (env: Env, k: string) => !!env[k]?.trim()

export function checkEnv(env: Env): EnvFinding[] {
  const out: EnvFinding[] = []
  const err = (key: string, message: string) => out.push({ level: "error", key, message })
  const warn = (key: string, message: string) => out.push({ level: "warn", key, message })

  if (!has(env, "DATABASE_URL")) err("DATABASE_URL", "required: Postgres connection string")
  if (!has(env, "APP_PASSWORD")) err("APP_PASSWORD", "required: the app refuses to serve in production without it")
  else if (env.APP_PASSWORD!.length < 12) warn("APP_PASSWORD", "shorter than 12 characters")

  for (const k of ["SENDER_NAME", "SENDER_ROLE", "SENDER_COMPANY"]) if (!has(env, k)) err(k, "required: every message must say who is sending it")
  if (!has(env, "SENDER_POSTAL_ADDRESS")) warn("SENDER_POSTAL_ADDRESS", "email pitches are rejected without a postal address (CAN-SPAM)")

  for (const k of ["CRON_SECRET", "ENGINE_WEBHOOK_SECRET", "AGENT_WEBHOOK_SECRET"]) {
    if (!has(env, k)) warn(k, "not set: this endpoint is closed in production until it is")
    else if (env[k]!.length < 24) warn(k, "shorter than 24 characters: use a random value (openssl rand -hex 32)")
  }

  if (!has(env, "YOUTUBE_API_KEY")) warn("YOUTUBE_API_KEY", "lead discovery needs it")
  if (has(env, "INSTAGRAM_ACCESS_TOKEN") !== has(env, "INSTAGRAM_IG_USER_ID")) warn("INSTAGRAM_IG_USER_ID", "set both INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_IG_USER_ID, or neither")

  const base = env.APP_BASE_URL ?? ""
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) warn("APP_BASE_URL", "should be your public https URL (tracking links use it)")

  if ((env.OUTREACH_MODE ?? "test") === "live") warn("OUTREACH_MODE", "live: messages can go to anyone. The assessment requires test mode (own accounts only)")
  else if (!has(env, "SEED_TEST_ALLOWLIST")) warn("SEED_TEST_ALLOWLIST", "empty: test mode can't send anything until your own test accounts are listed")
  if (has(env, "RESEND_API_KEY") !== has(env, "OUTREACH_FROM_EMAIL")) warn("OUTREACH_FROM_EMAIL", "set both RESEND_API_KEY and OUTREACH_FROM_EMAIL to send email")

  if ((env.AGENT_PROVIDER ?? "anthropic") === "anthropic" && !has(env, "ANTHROPIC_API_KEY")) warn("ANTHROPIC_API_KEY", "the AI agent can't run (or set AGENT_PROVIDER=ollama)")
  if (env.AGENT_PROVIDER === "ollama" && /localhost/.test(env.OLLAMA_URL ?? "http://localhost")) warn("OLLAMA_URL", "points at localhost: a hosted deployment can't reach your machine's Ollama")
  if (env.APIFY_DISCOVERY === "enabled") warn("APIFY_DISCOVERY", "enabled: the daily cron scrapes Instagram, which its terms don't allow")
  return out
}
