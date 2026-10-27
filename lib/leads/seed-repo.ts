// DB side of the seed test. Email goes through Resend (allowlisted recipients
// only). LinkedIn and Instagram have no permitted send API for this use, so
// those use a manual adapter: you send from your own account, then mark it sent.
import { desc, eq } from "drizzle-orm"
import { db } from "../db"
import { seedTestEvents, seedTests } from "../db/schema"
import { OPT_OUT, senderFromEnv } from "./config"
import { assertSendAllowed, newTrackingToken, parseAllowlist, seedReport, type AllowEntry } from "./seed-test"

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const baseUrl = () => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")

export async function recordSeedEvent(e: { seedTestId: string; channel: string; recipient: string; eventType: string; trackingToken?: string | null; targetUrl?: string | null; messageId?: string | null; metadata?: Record<string, unknown> }) {
  await db.insert(seedTestEvents).values({
    id: newId("sev"),
    seedTestId: e.seedTestId,
    channel: e.channel,
    recipient: e.recipient,
    eventType: e.eventType,
    trackingToken: e.trackingToken ?? null,
    targetUrl: e.targetUrl ?? null,
    messageId: e.messageId ?? null,
    occurredAt: new Date().toISOString(),
    metadata: e.metadata ? JSON.stringify(e.metadata) : null,
  })
}

export function seedMessage(testId: string, channel: string, link: string): { subject: string; body: string } {
  const s = senderFromEnv()
  const who = s ? `${s.name}, ${s.role} at ${s.company}` : "(sender not configured)"
  return {
    subject: `Seed test ${testId} (${channel})`,
    body: `This is a seed test of the outreach engine, sent only to an allowlisted test account.\n\nTracking link: ${link}\nPlease click it, then reply to this message.\n\n${who}\n${channel === "email" ? OPT_OUT.email : OPT_OUT.dm}`,
  }
}

export async function startSeedTest(opts: { send: boolean }): Promise<{ id: string; entries: (AllowEntry & { link: string; delivered: "resend" | "manual"; message: string; error?: string })[] }> {
  const entries = parseAllowlist(process.env.SEED_TEST_ALLOWLIST)
  if (!entries.length) throw new Error("SEED_TEST_ALLOWLIST is empty. Add accounts you own, e.g. email:you@yourdomain.com,instagram:@your_test_account")
  const id = newId("seed")
  await db.insert(seedTests).values({ id, status: "running", createdAt: new Date().toISOString() })
  const target = process.env.SEED_TEST_TARGET_URL || process.env.SENDER_WEBSITE || `${baseUrl()}/`
  const out = []
  for (const e of entries) {
    assertSendAllowed(e.channel, e.recipient)
    const token = newTrackingToken()
    const link = `${baseUrl()}/api/t/${token}`
    await recordSeedEvent({ seedTestId: id, channel: e.channel, recipient: e.recipient, eventType: "scheduled", trackingToken: token, targetUrl: target })
    const msg = seedMessage(id, e.channel, link)
    let delivered: "resend" | "manual" = "manual"
    let error: string | undefined
    if (opts.send && e.channel === "email" && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend")
        const r = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.OUTREACH_FROM_EMAIL || "outreach@example.com", to: e.recipient, subject: msg.subject, text: msg.body })
        if (r.error) throw new Error(r.error.message)
        await recordSeedEvent({ seedTestId: id, channel: e.channel, recipient: e.recipient, eventType: "sent", messageId: r.data?.id ?? null, metadata: { adapter: "resend" } })
        delivered = "resend"
      } catch (err) {
        error = (err as Error).message
      }
    }
    out.push({ ...e, link, delivered, message: `${msg.subject}\n\n${msg.body}`, error })
  }
  return { id, entries: out }
}

export async function clickByToken(token: string): Promise<string | null> {
  const ev = (await db.select().from(seedTestEvents).where(eq(seedTestEvents.trackingToken, token)))[0]
  if (!ev) return null
  await recordSeedEvent({ seedTestId: ev.seedTestId, channel: ev.channel, recipient: ev.recipient, eventType: "click", trackingToken: token })
  return ev.targetUrl
}

export async function logManualEvent(seedTestId: string, channel: string, eventType: "sent" | "reply", note?: string) {
  const entry = parseAllowlist(process.env.SEED_TEST_ALLOWLIST).find((e) => e.channel === channel)
  const scheduled = (await db.select().from(seedTestEvents).where(eq(seedTestEvents.seedTestId, seedTestId))).find((e) => e.channel === channel)
  const recipient = scheduled?.recipient ?? entry?.recipient
  if (!recipient) throw new Error(`no ${channel} recipient in seed test ${seedTestId}`)
  await recordSeedEvent({ seedTestId, channel, recipient, eventType, metadata: { adapter: "manual", note: note ?? null } })
  await refreshSeedStatus(seedTestId)
}

export async function refreshSeedStatus(seedTestId: string) {
  const report = await seedTestReport(seedTestId)
  await db.update(seedTests).set({ status: report.pass ? "passed" : "incomplete", finishedAt: report.pass ? new Date().toISOString() : null }).where(eq(seedTests.id, seedTestId))
  return report
}

export async function seedTestReport(seedTestId: string) {
  const events = await db.select().from(seedTestEvents).where(eq(seedTestEvents.seedTestId, seedTestId))
  const entries = [...new Map(events.filter((e) => e.eventType === "scheduled").map((e) => [`${e.channel}|${e.recipient}`, { channel: e.channel as AllowEntry["channel"], recipient: e.recipient }])).values()]
  return seedReport(entries, events)
}

export async function listSeedTests(limit = 10) {
  return db.select().from(seedTests).orderBy(desc(seedTests.createdAt)).limit(limit)
}
