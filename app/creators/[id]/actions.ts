"use server"
import { db } from "@/lib/db"
import { creators, tasks, tags } from "@/lib/db/schema"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { logActivity, newId } from "@/lib/activity"
import { isStage, type Stage } from "@/lib/stages"
import { autoTaskForStage, dueDateInDays } from "@/lib/stage-automations"
import { scrapeProfiles, findEmail } from "@/lib/apify-client"

export async function moveStage(creatorId: string, newStage: string) {
  if (!isStage(newStage)) throw new Error(`Invalid stage: ${newStage}`)
  const before = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0]
  if (!before) throw new Error("Creator not found")
  const fromStage = (before.stage as Stage) ?? null

  await db.update(creators)
    .set({ stage: newStage, stageChangedAt: new Date().toISOString() })
    .where(eq(creators.id, creatorId))

  await logActivity({
    creatorId,
    type: "stage_change",
    title: `Stage: ${fromStage ?? "—"} → ${newStage}`,
    metadata: { fromStage, toStage: newStage },
  })

  // Auto-create follow-up task for this stage
  const auto = autoTaskForStage(newStage as Stage, fromStage)
  if (auto) {
    const taskId = newId("task")
    await db.insert(tasks).values({
      id: taskId,
      creatorId,
      title: auto.title,
      body: auto.body ?? null,
      dueDate: dueDateInDays(auto.daysFromNow),
      source: "auto_stage_transition",
    } as any)
    await logActivity({
      creatorId,
      type: "task_created",
      title: `Auto-task: ${auto.title}`,
      body: `Due in ${auto.daysFromNow} day${auto.daysFromNow === 1 ? "" : "s"}`,
      metadata: { taskId, auto: true },
    })
  }

  revalidatePath("/pipeline")
  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/creators")
  revalidatePath("/")
}

export async function addNote(creatorId: string, body: string) {
  const trimmed = (body ?? "").trim()
  if (!trimmed) return
  await logActivity({
    creatorId,
    type: "note",
    title: "Note added",
    body: trimmed,
  })
  revalidatePath(`/creators/${creatorId}`)
}

export async function createTask(creatorId: string, title: string, dueInDays: number, body?: string) {
  const trimmed = (title ?? "").trim()
  if (!trimmed) return
  const taskId = newId("task")
  await db.insert(tasks).values({
    id: taskId,
    creatorId,
    title: trimmed,
    body: body?.trim() || null,
    dueDate: dueDateInDays(dueInDays),
    source: "manual",
  } as any)
  await logActivity({
    creatorId,
    type: "task_created",
    title: `Task: ${trimmed}`,
    body: `Due in ${dueInDays} day${dueInDays === 1 ? "" : "s"}`,
    metadata: { taskId },
  })
  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/")
}

export async function completeTask(taskId: string) {
  const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]
  if (!t) return
  await db.update(tasks)
    .set({ completed: true, completedAt: new Date().toISOString() })
    .where(eq(tasks.id, taskId))
  if (t.creatorId) {
    await logActivity({
      creatorId: t.creatorId,
      type: "task_completed",
      title: `✓ Done: ${t.title}`,
      metadata: { taskId },
    })
    revalidatePath(`/creators/${t.creatorId}`)
  }
  revalidatePath("/")
}

export async function uncompleteTask(taskId: string) {
  const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]
  if (!t) return
  await db.update(tasks)
    .set({ completed: false, completedAt: null })
    .where(eq(tasks.id, taskId))
  if (t.creatorId) revalidatePath(`/creators/${t.creatorId}`)
  revalidatePath("/")
}

// Update a creator's IG handle. Clears avatar/enrichedAt so the next enrichment pulls fresh data.
export async function updateHandle(creatorId: string, newHandle: string, newPlatform?: string) {
  const before = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0]
  if (!before) throw new Error("Creator not found")

  let h = (newHandle ?? "").trim()
  if (h && !h.startsWith("@")) h = "@" + h
  const cleaned = h || null

  const updates: Record<string, any> = { handle: cleaned }
  if (newPlatform) updates.platform = newPlatform

  // If handle changed, force re-enrichment by clearing all Apify-pulled fields
  if ((before.handle ?? "") !== (cleaned ?? "")) {
    updates.avatarUrl = null
    updates.enrichedAt = null
    if (cleaned) updates.profileUrl = `https://instagram.com/${cleaned.replace("@", "")}`
  }

  await db.update(creators).set(updates).where(eq(creators.id, creatorId))

  await logActivity({
    creatorId,
    type: "note",
    title: "Handle updated",
    body: `${before.handle ?? "(none)"} → ${cleaned ?? "(none)"}`,
  })

  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/creators")
}

// Re-enrich a single creator immediately via Apify
export async function enrichOne(creatorId: string): Promise<{ ok: boolean; filled: string[]; reason?: string }> {
  const c = (await db.select().from(creators).where(eq(creators.id, creatorId)))[0]
  if (!c) throw new Error("Creator not found")
  if (!process.env.APIFY_TOKEN) return { ok: false, filled: [], reason: "APIFY_TOKEN not set" }

  const u = (c.handle ?? "").replace("@", "").trim().toLowerCase()
  if (!u || u.length < 3 || u.includes(".com")) return { ok: false, filled: [], reason: "No valid handle" }

  const profiles = await scrapeProfiles([u])
  const p = profiles[0]
  if (!p) {
    await db.update(creators).set({ enrichedAt: new Date().toISOString() }).where(eq(creators.id, creatorId))
    return { ok: false, filled: [], reason: "Apify returned no profile" }
  }

  const fc = p.followersCount ?? null
  const posts = p.latestPosts || []
  const er = (() => {
    if (!fc || !posts.length) return null
    const avg = posts.reduce((s, x) => s + (x.likesCount ?? 0) + (x.commentsCount ?? 0) * 2, 0) / posts.length
    return Math.min((avg / fc) * 100, 100)
  })()

  const updates: Record<string, any> = { enrichedAt: new Date().toISOString() }
  if (fc) updates.followers = fc
  if (p.biography) updates.bio = p.biography.slice(0, 500)
  if (p.externalUrl) updates.externalUrl = p.externalUrl
  const pic = (p as any).profilePicUrlHD ?? (p as any).profilePicUrl
  if (pic) updates.avatarUrl = pic
  if (er != null) updates.engagementRate = er
  if (!c.email) {
    const found = await findEmail(p)
    if (found) updates.email = found
  }

  await db.update(creators).set(updates).where(eq(creators.id, creatorId))

  const filled = Object.keys(updates).filter((k) => k !== "enrichedAt")
  await logActivity({
    creatorId,
    type: "note",
    title: "Profile re-enriched from Apify",
    body: `Filled: ${filled.join(", ")}`,
    metadata: { source: "apify-enrich-one" },
  })

  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/creators")
  return { ok: true, filled }
}

export async function addTag(creatorId: string, name: string) {
  const trimmed = (name ?? "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32)
  if (!trimmed) return
  // Check dup
  const existing = await db.select().from(tags).where(and(eq(tags.creatorId, creatorId), eq(tags.name, trimmed)))
  if (existing.length > 0) return
  await db.insert(tags).values({
    id: newId("tag"),
    creatorId,
    name: trimmed,
  } as any)
  await logActivity({
    creatorId,
    type: "tag_added",
    title: `Tag added: ${trimmed}`,
  })
  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/creators")
}

export async function removeTag(creatorId: string, name: string) {
  await db.delete(tags).where(and(eq(tags.creatorId, creatorId), eq(tags.name, name)))
  await logActivity({
    creatorId,
    type: "tag_removed",
    title: `Tag removed: ${name}`,
  })
  revalidatePath(`/creators/${creatorId}`)
  revalidatePath("/creators")
}
