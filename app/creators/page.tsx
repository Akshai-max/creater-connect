import { db } from "@/lib/db"
import { creators, tags } from "@/lib/db/schema"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { desc, asc } from "drizzle-orm"
import Link from "next/link"
import { formatNumber } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { STAGES, STAGE_COLORS, type Stage } from "@/lib/stages"
import { displayPrice } from "@/lib/rate-estimator"
import { Avatar } from "@/components/avatar"
import { RosterTagsCell } from "./roster-tags-cell"

export const dynamic = "force-dynamic"

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ q?: string; platform?: string; stage?: string; tag?: string }> }) {
  const params = await searchParams
  const all = await db.select().from(creators).orderBy(desc(creators.followers))
  const allTags = await db.select().from(tags).orderBy(asc(tags.name))

  // creator_id → tag names
  const tagsByCreator: Record<string, string[]> = {}
  for (const t of allTags) {
    if (!tagsByCreator[t.creatorId]) tagsByCreator[t.creatorId] = []
    tagsByCreator[t.creatorId].push(t.name)
  }

  // Unique tag names + counts
  const tagCounts: Record<string, number> = {}
  for (const t of allTags) tagCounts[t.name] = (tagCounts[t.name] ?? 0) + 1
  const allTagNames = Object.keys(tagCounts).sort()

  const q = (params.q ?? "").toLowerCase()
  const filtered = all.filter((c) => {
    if (params.platform && params.platform !== "all" && c.platform !== params.platform) return false
    if (params.stage && params.stage !== "all" && c.stage !== params.stage) return false
    if (params.tag) {
      const ct = tagsByCreator[c.id] ?? []
      if (!ct.includes(params.tag)) return false
    }
    if (!q) return true
    return [c.name, c.handle, c.location, c.flagNotes, c.email]
      .filter(Boolean)
      .some((s) => String(s).toLowerCase().includes(q))
  })

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Roster</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {filtered.length} of {all.length} creators · {all.filter((c) => !c.followers).length} missing data
              {(() => {
                const junkCount = all.filter((c) => {
                  const v = (c.handle ?? "").replace("@", "").trim().toLowerCase()
                  if (!v) return false
                  if (v.length < 3) return true
                  if (v.includes("@") || v.includes(".com") || v.includes(".net")) return true
                  return ["ps", "reel", "gmail", "hotmail", "yahoo"].includes(v)
                }).length
                if (junkCount === 0) return null
                return (
                  <>
                    {" · "}
                    <Link href="/creators/fix-handles" className="text-amber-600 dark:text-amber-400 hover:underline">
                      ⚠ {junkCount} junk handles · fix
                    </Link>
                  </>
                )
              })()}
            </p>
          </div>
          <form className="flex gap-2 items-center flex-wrap" action="/creators">
            <Input name="q" defaultValue={params.q} placeholder="Search…" className="w-64" />
            <select name="platform" defaultValue={params.platform ?? "all"} className="h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 text-sm">
              <option value="all">All platforms</option>
              <option value="IG">Instagram</option>
              <option value="TikTok">TikTok</option>
              <option value="YouTube">YouTube</option>
            </select>
            <select name="stage" defaultValue={params.stage ?? "all"} className="h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 text-sm">
              <option value="all">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {params.tag && <input type="hidden" name="tag" value={params.tag} />}
            <button type="submit" className="h-9 px-4 rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 text-sm">Filter</button>
            {(params.q || params.platform !== "all" || params.stage !== "all" || params.tag) && (
              <Link href="/creators" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Clear</Link>
            )}
          </form>
        </div>

        {allTagNames.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-zinc-500">tags:</span>
            {params.tag && (
              <Link href="/creators" className="rounded-full bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 px-2.5 py-0.5">
                #{params.tag} ✕
              </Link>
            )}
            {!params.tag && allTagNames.slice(0, 30).map((t) => (
              <Link key={t} href={`/creators?tag=${encodeURIComponent(t)}`} className="rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-2.5 py-0.5">
                #{t} <span className="text-zinc-400">{tagCounts[t]}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creator</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Est. price</TableHead>
                <TableHead>Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const stage = (c.stage as Stage) ?? "Lead"
                const ctags = tagsByCreator[c.id] ?? []
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/creators/${c.id}`} className="flex items-center gap-3 group">
                        <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="sm" />
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-900 dark:text-zinc-50 truncate group-hover:underline">{c.name}</div>
                          <div className="text-xs text-zinc-500 truncate">{c.handle ?? "—"}</div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[stage]}`}>
                        {stage}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{c.platform ?? "—"}</Badge></TableCell>
                    <TableCell className="tabular-nums">{formatNumber(c.followers)}</TableCell>
                    <TableCell className="text-zinc-500 text-xs">{c.location ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <RosterTagsCell creatorId={c.id} tags={ctags} suggestions={allTagNames} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {(() => {
                        const p = displayPrice(c)
                        return (
                          <>
                            <div className={`tabular-nums ${p.source === "actual" ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"}`}>
                              {p.primary}
                            </div>
                            <div className="text-[10px] text-zinc-400">{p.secondary}</div>
                          </>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs text-zinc-500">
                      {c.ratePaid ? `$${c.ratePaid.toLocaleString()}` : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
