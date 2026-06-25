"use server"
import { db } from "@/lib/db"
import { creators, outreach } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logActivity, newId } from "@/lib/activity"
import { OUTREACH_SYSTEM_PROMPT, buildUserPrompt, templateDraft } from "@/lib/outreach-prompt"

// ─────────────────────────────────────────────────────────────────────────────
// Draft a personalized pitch via Claude (or fall back to a template).
// Uses Haiku 4.5 with prompt caching on the system prompt for low cost.
// ─────────────────────────────────────────────────────────────────────────────
export async function draftOutreach(creatorId: string, campaignBrief?: string): Promise<{ subject: string; body: string; source: "ai" | "template" }> {
  const c = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0]
  if (!c) throw new Error("Creator not found")

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { ...templateDraft(c as any), source: "template" }
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const client = new Anthropic({ apiKey })
    const userPrompt = buildUserPrompt(c as any, campaignBrief)

    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: [
        {
          type: "text",
          text: OUTREACH_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    })

    const text = result.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")

    // Strip markdown fences if present
    const jsonText = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim()
    const parsed = JSON.parse(jsonText)
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
      throw new Error("Bad model output shape")
    }
    return { subject: parsed.subject, body: parsed.body, source: "ai" }
  } catch (e) {
    console.error("draftOutreach AI failed, falling back to template:", e)
    return { ...templateDraft(c as any), source: "template" }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send an outreach: persist + (optionally) deliver via Resend.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendOutreach(opts: {
  creatorId: string
  subject: string
  body: string
  toEmail?: string
  saveDraftOnly?: boolean
}): Promise<{ ok: boolean; outreachId: string; sent: boolean; error?: string }> {
  const c = (await db.select().from(creators).where(eq(creators.id, opts.creatorId)))[0]
  if (!c) throw new Error("Creator not found")

  const id = newId("out")
  const to = opts.toEmail || c.email || ""
  const fromEmail = process.env.OUTREACH_FROM_EMAIL || "outreach@example.com"
  const apiKey = process.env.RESEND_API_KEY

  const baseRow = {
    id,
    creatorId: opts.creatorId,
    toEmail: to,
    fromEmail,
    subject: opts.subject,
    body: opts.body,
    channel: "email",
    owner: "You",
  }

  // Save-as-draft path
  if (opts.saveDraftOnly || !apiKey || !to) {
    await db.insert(outreach).values({ ...baseRow, status: "draft" } as any)
    await logActivity({
      creatorId: opts.creatorId,
      type: "email_sent",
      title: opts.saveDraftOnly ? "Outreach drafted (saved)" : !apiKey ? "Outreach drafted (no RESEND_API_KEY set)" : "Outreach drafted (no recipient email)",
      body: `Subject: ${opts.subject}`,
    })
    revalidatePath("/outreach")
    revalidatePath(`/creators/${opts.creatorId}`)
    return { ok: true, outreachId: id, sent: false, error: !to ? "no recipient email" : !apiKey ? "RESEND_API_KEY not set" : undefined }
  }

  // Real send path via Resend
  try {
    const { Resend } = await import("resend")
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: fromEmail,
      to,
      subject: opts.subject,
      text: opts.body,
    })

    if (result.error) throw new Error(result.error.message)

    await db.insert(outreach).values({
      ...baseRow,
      status: "sent",
      sentAt: new Date().toISOString(),
      messageId: result.data?.id ?? null,
    } as any)

    await logActivity({
      creatorId: opts.creatorId,
      type: "email_sent",
      title: `Email sent: ${opts.subject}`,
      body: opts.body.slice(0, 200) + (opts.body.length > 200 ? "…" : ""),
      metadata: { outreachId: id, messageId: result.data?.id, to },
    })
    revalidatePath("/outreach")
    revalidatePath(`/creators/${opts.creatorId}`)
    revalidatePath("/")
    return { ok: true, outreachId: id, sent: true }
  } catch (e: any) {
    await db.insert(outreach).values({
      ...baseRow,
      status: "draft",
      failedAt: new Date().toISOString(),
      failedReason: String(e?.message ?? e),
    } as any)
    return { ok: false, outreachId: id, sent: false, error: String(e?.message ?? e) }
  }
}

export async function markReplied(outreachId: string) {
  const o = (await db.select().from(outreach).where(eq(outreach.id, outreachId)))[0]
  if (!o) return
  await db.update(outreach).set({ status: "replied", repliedAt: new Date().toISOString() }).where(eq(outreach.id, outreachId))
  await logActivity({
    creatorId: o.creatorId,
    type: "email_received",
    title: `Reply received`,
    body: `On: ${o.subject}`,
    metadata: { outreachId },
  })
  revalidatePath("/outreach")
  revalidatePath(`/creators/${o.creatorId}`)
}

export async function markCold(outreachId: string) {
  const o = (await db.select().from(outreach).where(eq(outreach.id, outreachId)))[0]
  if (!o) return
  await db.update(outreach).set({ status: "cold" }).where(eq(outreach.id, outreachId))
  revalidatePath("/outreach")
  revalidatePath(`/creators/${o.creatorId}`)
}
