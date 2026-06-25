// End-to-end smoke test of CRM core features
import { db } from "../lib/db"
import { creators, activities, tasks, tags } from "../lib/db/schema"
import { eq, and } from "drizzle-orm"
import { logActivity, newId } from "../lib/activity"
import { autoTaskForStage, dueDateInDays } from "../lib/stage-automations"

async function main() {
  const TEST_ID = "CR001"
  console.log(`Testing CRM flow on ${TEST_ID}...\n`)

  // 1. Add a note via activity
  await logActivity({
    creatorId: TEST_ID,
    type: "note",
    title: "Note added",
    body: "[smoke test] Spoke to the creator on the phone — they're interested in a product pilot",
  })
  console.log("✅ Added note")

  // 2. Move stage Past Hire → Outreached
  const before = (await db.select().from(creators).where(eq(creators.id, TEST_ID)))[0]
  await db.update(creators).set({
    stage: "Outreached",
    stageChangedAt: new Date().toISOString(),
  }).where(eq(creators.id, TEST_ID))
  await logActivity({
    creatorId: TEST_ID,
    type: "stage_change",
    title: `Stage: ${before.stage} → Outreached`,
    metadata: { fromStage: before.stage, toStage: "Outreached" },
  })

  // 3. Auto-create the follow-up task
  const auto = autoTaskForStage("Outreached", before.stage as any)
  if (auto) {
    const taskId = newId("task")
    await db.insert(tasks).values({
      id: taskId,
      creatorId: TEST_ID,
      title: auto.title,
      body: auto.body ?? null,
      dueDate: dueDateInDays(auto.daysFromNow),
      source: "auto_stage_transition",
    } as any)
    await logActivity({
      creatorId: TEST_ID,
      type: "task_created",
      title: `Auto-task: ${auto.title}`,
      body: `Due in ${auto.daysFromNow} days`,
      metadata: { taskId, auto: true },
    })
    console.log(`✅ Stage moved + auto-task created (${auto.title})`)
  }

  // 4. Add a tag
  const tagId = newId("tag")
  // Check dup
  const dup = await db.select().from(tags).where(and(eq(tags.creatorId, TEST_ID), eq(tags.name, "demo-pilot")))
  if (dup.length === 0) {
    await db.insert(tags).values({ id: tagId, creatorId: TEST_ID, name: "demo-pilot" } as any)
    await logActivity({ creatorId: TEST_ID, type: "tag_added", title: "Tag added: demo-pilot" })
    console.log("✅ Added tag #demo-pilot")
  }

  // 5. Verify everything got logged
  const acts = await db.select().from(activities).where(eq(activities.creatorId, TEST_ID))
  const ts = await db.select().from(tasks).where(eq(tasks.creatorId, TEST_ID))
  const tg = await db.select().from(tags).where(eq(tags.creatorId, TEST_ID))

  console.log(`\n📊 ${TEST_ID} now has:`)
  console.log(`   ${acts.length} activities`)
  console.log(`   ${ts.length} tasks (${ts.filter((t) => !t.completed).length} open)`)
  console.log(`   ${tg.length} tags`)
  console.log(`\nView in browser: http://localhost:3000/creators/${TEST_ID}`)
}

main()
