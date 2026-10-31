"use server"
import { db } from "@/lib/db"
import { creators, outreach } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logActivity, newId } from "@/lib/activity"
import { OUTREACH_SYSTEM_PROMPT, buildUserPrompt, templateDraft } from "@/lib/outreach-prompt"
import { assertSendAllowed } from "@/lib/leads/seed-test"
import { stageAfterOutreach, type OutreachEvent } from "@/lib/stages"
import { moveStage } from "@/app/creators/[id]/actions"

// Keep the pipeline in step with the pitch: sent/replied/cold move the creator
// forward from the early stages (see stageAfterOutreach). Also revalidates /pipeline.
async function syncStage(creatorId: string, event: OutreachEvent) {
  const c = (await db.select({ stage: creators.stage }).from(creators).where(eq(creators.id, creatorId)))[0]
  const next = c ? stageAfterOutreach(c.stage, event) : null
  if (next) await moveStage(creatorId, next)
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft a personalized pitch via Claude or the multi-provider LLM router
// (Groq, Gemini, OpenRouter, Ollama), falling back to template if no LLM is ready.
// ─────────────────────────────────────────────────────────────────────────────
export async function draftOutreach(
  creatorId: string,
  campaignBrief?: string
): Promise<{ subject: string; body: string; source: "ai" | "template"; model?: string }> {
  const c = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0]
  if (!c) throw new Error("Creator not found")

  const userPrompt = buildUserPrompt(c as any, campaignBrief)

  // 1. If Anthropic is configured, try Claude first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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

      const jsonText = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim()
      const parsed = JSON.parse(jsonText)
      if (typeof parsed.subject === "string" && typeof parsed.body === "string") {
        return { subject: parsed.subject, body: parsed.body, source: "ai", model: "Claude Haiku 4.5" }
      }
    } catch (e) {
      console.error("draftOutreach Anthropic failed, trying router:", e)
    }
  }

  // 2. Try configured LLM router providers (Groq, Gemini, OpenRouter, Ollama)
  try {
    const { defaultRouter } = await import("@/lib/llm/router")
    const router = defaultRouter()
    const r = await router.call({
      purpose: "outreach_draft",
      subjectRef: creatorId,
      json: true,
      maxTokens: 800,
      messages: [
        { role: "system", content: `${OUTREACH_SYSTEM_PROMPT}\n\nReturn JSON only with keys "subject" and "body".` },
        { role: "user", content: userPrompt },
      ],
      parse: (m) => {
        const text = (m.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
        const parsed = JSON.parse(text)
        if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
          throw new Error("Bad model output shape")
        }
        return parsed as { subject: string; body: string }
      },
    })
    return { subject: r.value.subject, body: r.value.body, source: "ai", model: `${r.provider} (${r.model})` }
  } catch (e) {
    console.error("draftOutreach LLM router failed, falling back to template:", e)
  }

  // 3. Fallback to template
  return { ...templateDraft(c as any), source: "template" }
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
  const rawFrom = process.env.OUTREACH_FROM_EMAIL?.trim()
  const fromEmail = (!rawFrom || rawFrom.endsWith("@example.com")) ? "onboarding@resend.dev" : rawFrom
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

  // Test mode (default): only allowlisted owned accounts can receive real email.
  try {
    assertSendAllowed("email", to)
  } catch (e: any) {
    await db.insert(outreach).values({ ...baseRow, status: "draft", failedReason: String(e?.message ?? e) } as any)
    revalidatePath("/outreach")
    return { ok: false, outreachId: id, sent: false, error: String(e?.message ?? e) }
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
    await syncStage(opts.creatorId, "sent")
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
  await syncStage(o.creatorId, "replied")
  revalidatePath("/outreach")
  revalidatePath(`/creators/${o.creatorId}`)
}

export async function markCold(outreachId: string) {
  const o = (await db.select().from(outreach).where(eq(outreach.id, outreachId)))[0]
  if (!o) return
  await db.update(outreach).set({ status: "cold" }).where(eq(outreach.id, outreachId))
  await syncStage(o.creatorId, "cold")
  revalidatePath("/outreach")
  revalidatePath(`/creators/${o.creatorId}`)
}
