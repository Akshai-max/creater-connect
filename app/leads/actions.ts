"use server"
import { db } from "@/lib/db"
import { creators, leads, outreachMessages } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logActivity, newId } from "@/lib/activity"
import { upsertSequences } from "@/lib/leads/repo"
import { validateMessage } from "@/lib/leads/messages"
import { senderFromEnv } from "@/lib/leads/config"

export async function saveMessage(leadId: string, channel: string, sequence: number, subject: string | null, body: string) {
  if (body.length > 5000) throw new Error("Message too long")
  await db.update(outreachMessages)
    .set({ subject, body, edited: true, status: "draft", approvedAt: null, updatedAt: new Date().toISOString() })
    .where(and(eq(outreachMessages.leadId, leadId), eq(outreachMessages.channel, channel), eq(outreachMessages.sequence, sequence)))
  revalidatePath(`/leads/${leadId}`)
}

// Approval re-runs the same checks used at generation time, so an edit that
// drops the opt-out or sender line can't be approved.
export async function approveMessage(leadId: string, channel: string, sequence: number): Promise<{ ok: boolean; problems: string[] }> {
  const m = (await db.select().from(outreachMessages).where(and(eq(outreachMessages.leadId, leadId), eq(outreachMessages.channel, channel), eq(outreachMessages.sequence, sequence))))[0]
  if (!m || m.status === "unavailable") return { ok: false, problems: ["message unavailable"] }
  const sender = senderFromEnv()
  if (!sender) return { ok: false, problems: ["sender identity not configured"] }
  const l = (await db.select({ title: leads.recentContentTitle, url: leads.recentContentUrl }).from(leads).where(eq(leads.id, leadId)))[0]
  const v = validateMessage({ channel: m.channel as any, sequence: m.sequence as any, body: m.body ?? "", subject: m.subject }, sender, l?.title && l.url && sequence === 1 ? { title: l.title, url: l.url } : null)
  if (!v.ok) return v
  await db.update(outreachMessages).set({ status: "approved", approvedAt: new Date().toISOString() }).where(eq(outreachMessages.id, m.id))
  revalidatePath(`/leads/${leadId}`)
  return v
}

export async function draftSequencesFor(leadId: string) {
  const l = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
  if (!l) throw new Error("Lead not found")
  await upsertSequences(l, new Date().toISOString())
  revalidatePath(`/leads/${leadId}`)
}

// Hand a qualified lead to the existing CRM pipeline (roster, stages, tasks).
export async function addLeadToPipeline(leadId: string): Promise<string> {
  const l = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
  if (!l) throw new Error("Lead not found")
  if (l.candidateStatus !== "qualified") throw new Error("Only qualified leads can be added to the pipeline")
  if (l.creatorId) return l.creatorId
  const id = newId("cr")
  await db.insert(creators).values({
    id,
    name: l.creatorName,
    handle: l.bestChannel === "instagram" ? l.channelHandleOrUrl : null,
    platform: l.primaryPlatform,
    profileUrl: l.profileUrl,
    followers: l.followers,
    email: l.bestChannel === "email" ? l.channelHandleOrUrl : null,
    location: l.countryIso2,
    source: `lead:${l.id}`,
    niche: l.segment,
    stage: "Lead",
    stageChangedAt: new Date().toISOString(),
  } as any)
  await db.update(leads).set({ creatorId: id }).where(eq(leads.id, leadId))
  await logActivity({ creatorId: id, type: "stage_change", title: `Added from qualified lead ${l.id}`, body: l.personalizationHook ?? null, metadata: { leadId: l.id, score: l.leadScore } })
  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/creators")
  return id
}
