// Which discovery sources produce qualified leads.
//   npm run discovery-yield            (by search topic / source kind)
//   npm run discovery-yield -- --full  (by exact tag, e.g. "search:business coach|US")
// Joins each lead's discovered_via (written by the cycle since 2026-10-31; older leads have none)
// with its status in the database. "Near" = unverified and only missing a contact and/or the entity
// check, the leads most likely to qualify next. Use it to keep the searches in
// data/discovery-queries.txt that lead somewhere and drop the ones that don't.
import fs from "node:fs"
import { parseArgs } from "node:util"
import { parse } from "csv-parse/sync"
import { eq } from "drizzle-orm"
import { db } from "../lib/db"
import { leads } from "../lib/db/schema"

const { values } = parseArgs({ options: { input: { type: "string", default: "data/discovered-2026-10-29.csv" }, full: { type: "boolean", default: false } } })

// "search:business coach|US" → "search: business coach"; "featured:UC…" → "featured channels".
function group(tag: string): string {
  if (values.full) return tag
  const i = tag.indexOf(":")
  const kind = i < 0 ? tag : tag.slice(0, i)
  const rest = i < 0 ? "" : tag.slice(i + 1)
  if (kind === "search" || kind === "videos") return `${kind}: ${rest.split("|")[0]}`
  if (kind === "apple") return `apple: ${rest}`
  if (kind === "featured") return "featured channels"
  return kind
}

async function main() {
  const rows = parse(fs.readFileSync(values.input!, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  const via = new Map(rows.filter((r) => r.discovered_via).map((r) => [r.stable_creator_id, r.discovered_via]))
  if (!via.size) {
    console.log("No lead has a discovered_via tag yet: the cycle adds it to channels found from 2026-10-31 on.")
    return
  }
  const db_ = await db.select({ key: leads.identityKey, s: leads.candidateStatus, c: leads.qualificationChecks }).from(leads).where(eq(leads.isFixture, false))
  const near = (c: string | null) => (JSON.parse(c ?? "[]") as { id: string; pass: boolean }[])
    .filter((x) => !x.pass && x.id !== "complete" && x.id !== "message").every((x) => x.id === "contact" || x.id === "entity")
  const g = new Map<string, { n: number; q: number; near: number; rej: number }>()
  for (const l of db_) {
    const tag = via.get(String(l.key).replace(/^youtube:/, ""))
    if (!tag) continue
    const k = group(tag)
    const e = g.get(k) ?? { n: 0, q: 0, near: 0, rej: 0 }
    e.n++
    if (l.s === "qualified") e.q++
    else if (l.s === "unverified" && near(l.c)) e.near++
    else if (l.s === "rejected") e.rej++
    g.set(k, e)
  }
  const list = [...g].sort((a, b) => (b[1].q + b[1].near) / b[1].n - (a[1].q + a[1].near) / a[1].n || b[1].n - a[1].n)
  console.log(`${"source".padEnd(48)} ${"leads".padStart(5)} ${"qual".padStart(4)} ${"near".padStart(4)} ${"rej%".padStart(5)} ${"(qual+near)%".padStart(12)}`)
  for (const [k, e] of list) {
    console.log(`${k.slice(0, 48).padEnd(48)} ${String(e.n).padStart(5)} ${String(e.q).padStart(4)} ${String(e.near).padStart(4)} ${((100 * e.rej) / e.n).toFixed(0).padStart(4)}% ${((100 * (e.q + e.near)) / e.n).toFixed(1).padStart(11)}%`)
  }
  console.log(`\n${via.size} tagged leads in the file, ${[...g.values()].reduce((s, e) => s + e.n, 0)} of them already scored in the database.`)
}

main().catch((e) => {
  console.error(`[yield] ${(e as Error).message}`)
  process.exitCode = 1
})
