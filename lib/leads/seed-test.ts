// Seed test: prove scheduling, tracking links and reply logging work, using
// ONLY accounts you own. Test mode is the default and refuses any recipient
// that isn't on SEED_TEST_ALLOWLIST.
import { randomBytes } from "node:crypto"
import type { OutreachChannel } from "./types"

export type AllowEntry = { channel: OutreachChannel; recipient: string }

// SEED_TEST_ALLOWLIST="email:me@mydomain.com,linkedin:https://www.linkedin.com/in/me,instagram:@my_test_account"
export function parseAllowlist(raw: string | undefined): AllowEntry[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":")
      const channel = s.slice(0, i).trim().toLowerCase() as OutreachChannel
      const recipient = s.slice(i + 1).trim()
      return { channel, recipient }
    })
    .filter((e) => ["email", "linkedin", "instagram"].includes(e.channel) && e.recipient)
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, "").replace(/\/+$/, "")

export function isAllowlisted(channel: string, recipient: string, list: AllowEntry[]): boolean {
  return list.some((e) => e.channel === channel && norm(e.recipient) === norm(recipient))
}

export function outreachMode(env: Record<string, string | undefined> = process.env): "test" | "live" {
  return env.OUTREACH_MODE === "live" ? "live" : "test"
}

// Throws unless sending is safe: in test mode the recipient must be allowlisted.
export function assertSendAllowed(channel: string, recipient: string, env: Record<string, string | undefined> = process.env) {
  if (outreachMode(env) === "live") return
  if (!isAllowlisted(channel, recipient, parseAllowlist(env.SEED_TEST_ALLOWLIST))) {
    throw new Error(`Test mode: ${channel} recipient is not on SEED_TEST_ALLOWLIST; refusing to send.`)
  }
}

export const newTrackingToken = () => randomBytes(12).toString("base64url")

export const EXPECTED_EVENTS = ["scheduled", "sent", "click", "reply"] as const
export type SeedEventType = (typeof EXPECTED_EVENTS)[number]

export type SeedReportRow = { channel: string; recipient: string; expected: SeedEventType[]; observed: { type: string; at: string }[]; missing: SeedEventType[]; pass: boolean }

export function seedReport(entries: AllowEntry[], events: { channel: string; recipient: string; eventType: string; occurredAt: string }[]): { rows: SeedReportRow[]; pass: boolean } {
  const rows = entries.map((e) => {
    const obs = events
      .filter((x) => x.channel === e.channel && norm(x.recipient) === norm(e.recipient))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((x) => ({ type: x.eventType, at: x.occurredAt }))
    const missing = EXPECTED_EVENTS.filter((t) => !obs.some((o) => o.type === t))
    return { channel: e.channel, recipient: e.recipient, expected: [...EXPECTED_EVENTS], observed: obs, missing, pass: missing.length === 0 }
  })
  return { rows, pass: rows.length > 0 && rows.every((r) => r.pass) }
}
