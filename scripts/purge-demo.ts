// Remove demo / sample / test-fixture data so only real data is left.
//   npm run purge-demo                      dry run: lists what would be removed
//   npm run purge-demo -- --yes             back up to data/backups/ and delete
//   npm run purge-demo -- --yes --run-history   also clear engine and agent run logs
// What counts as demo:
//   creators   name ends with "(sample)" or email/handle on an example domain
//   candidates id starts with "cand_demo_" or name ends with "(sample)"
//   leads      is_fixture = true (evidence and messages cascade)
//   outreach, tasks, activities, tags belonging to demo creators
// Run history (engine_runs, agent_runs) is only cleared with --run-history,
// because on a real install it is the audit trail.
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { eq, ilike, inArray, like, or } from "drizzle-orm"
import { db } from "../lib/db"
import { activities, agentRuns, candidates, creators, engineRuns, leads, outreach, tags, tasks } from "../lib/db/schema"

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false }, "run-history": { type: "boolean", default: false } } })

async function main() {
  const demoCreators = await db.select().from(creators).where(or(
    like(creators.name, "%(sample)"),
    ilike(creators.email, "%@example.com"),
    ilike(creators.email, "%@example.org"),
  ))
  const creatorIds = demoCreators.map((c) => c.id)
  const demoCandidates = await db.select().from(candidates).where(or(like(candidates.id, "cand_demo_%"), like(candidates.fullName, "%(sample)")))
  const fixtureLeads = await db.select().from(leads).where(eq(leads.isFixture, true))
  const byCreator = <T>(rows: Promise<T[]>) => (creatorIds.length ? rows : Promise.resolve([] as T[]))
  const [demoOutreach, demoTasks, demoActivities, demoTags] = await Promise.all([
    byCreator(db.select().from(outreach).where(inArray(outreach.creatorId, creatorIds))),
    byCreator(db.select().from(tasks).where(inArray(tasks.creatorId, creatorIds))),
    byCreator(db.select().from(activities).where(inArray(activities.creatorId, creatorIds))),
    byCreator(db.select().from(tags).where(inArray(tags.creatorId, creatorIds))),
  ])
  const runs = values["run-history"]
    ? { engine: await db.select().from(engineRuns), agent: await db.select().from(agentRuns) }
    : { engine: [], agent: [] }

  const plan = {
    creators: demoCreators.map((c) => `${c.id} ${c.name}`),
    candidates: demoCandidates.map((c) => `${c.id} ${c.fullName ?? c.handle}`),
    fixtureLeads: fixtureLeads.length,
    outreach: demoOutreach.length,
    tasks: demoTasks.length,
    activities: demoActivities.length,
    tags: demoTags.length,
    engineRuns: runs.engine.length,
    agentRuns: runs.agent.length,
  }
  console.log(JSON.stringify(plan, null, 2))
  if (!values.yes) {
    console.log("\nDry run. Add --yes to back up and delete these rows.")
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backup = path.join("data", "backups", `demo-${stamp}.json`)
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.writeFileSync(backup, JSON.stringify({ creators: demoCreators, candidates: demoCandidates, leads: fixtureLeads, outreach: demoOutreach, tasks: demoTasks, activities: demoActivities, tags: demoTags, ...runs }, null, 1))
  console.log(`\nBackup written: ${backup}`)

  if (creatorIds.length) {
    await db.delete(tags).where(inArray(tags.creatorId, creatorIds))
    await db.delete(activities).where(inArray(activities.creatorId, creatorIds))
    await db.delete(tasks).where(inArray(tasks.creatorId, creatorIds))
    await db.delete(outreach).where(inArray(outreach.creatorId, creatorIds))
    // Leads linked to a demo creator lose the link rather than the lead.
    await db.update(leads).set({ creatorId: null }).where(inArray(leads.creatorId, creatorIds))
    await db.delete(creators).where(inArray(creators.id, creatorIds))
  }
  if (demoCandidates.length) await db.delete(candidates).where(inArray(candidates.id, demoCandidates.map((c) => c.id)))
  if (fixtureLeads.length) await db.delete(leads).where(eq(leads.isFixture, true)) // evidence + messages cascade
  if (values["run-history"]) {
    await db.delete(agentRuns) // proposals cascade
    await db.delete(engineRuns)
  }
  console.log("Deleted.")
}

main().catch((e) => {
  console.error(`[purge-demo] ${(e as Error).message}`)
  process.exitCode = 1
})
