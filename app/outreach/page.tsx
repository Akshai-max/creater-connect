import { db } from "@/lib/db"
import { outreach, creators } from "@/lib/db/schema"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { desc } from "drizzle-orm"
import Link from "next/link"
import { Mail, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { relativeDate } from "@/lib/utils"
import { OutreachStatusActions } from "./status-actions"

export const dynamic = "force-dynamic"

const STATUS_TABS = ["all", "draft", "sent", "replied", "cold"] as const

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams
  const status = (params.status ?? "all") as (typeof STATUS_TABS)[number]

  const all = await db.select().from(outreach).orderBy(desc(outreach.createdAt))
  const filtered = status === "all" ? all : all.filter((o) => o.status === status)

  const allCreators = await db.select({ id: creators.id, name: creators.name, handle: creators.handle }).from(creators)
  const creatorById = new Map(allCreators.map((c) => [c.id, c]))

  const counts: Record<string, number> = { all: all.length }
  for (const o of all) counts[o.status ?? "draft"] = (counts[o.status ?? "draft"] ?? 0) + 1

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {all.length} total · {counts.sent ?? 0} sent · {counts.replied ?? 0} replied
          </p>
        </div>
        <Link href="/outreach/compose">
          <Button><Plus className="h-4 w-4" /> New pitch</Button>
        </Link>
      </div>

      {/* Setup-needed banner hidden for now (re-enable by reverting this edit) */}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/outreach" : `/outreach?status=${s}`}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              status === s
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {s} <span className="opacity-60">({counts[s] ?? 0})</span>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              <Mail className="h-8 w-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-700" />
              <p>No {status === "all" ? "outreach yet" : `${status} pitches`}.</p>
              <Link href="/outreach/compose" className="inline-flex items-center gap-1 mt-2 text-zinc-700 dark:text-zinc-300 hover:underline">
                Compose your first pitch →
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creator</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => {
                  const c = creatorById.get(o.creatorId)
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        {c ? (
                          <Link href={`/creators/${c.id}`} className="block">
                            <div className="font-medium text-zinc-900 dark:text-zinc-50">{c.name}</div>
                            <div className="text-xs text-zinc-500">{c.handle ?? "—"}</div>
                          </Link>
                        ) : (
                          <span className="text-zinc-500">{o.creatorId}</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm truncate">{o.subject ?? "(no subject)"}</div>
                        <div className="text-xs text-zinc-500 truncate">{o.body?.slice(0, 80)}…</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          o.status === "sent" ? "info" :
                          o.status === "replied" ? "success" :
                          o.status === "cold" ? "danger" :
                          "secondary"
                        }>{o.status}</Badge>
                        {o.failedReason && <div className="text-[10px] text-red-600 mt-0.5 max-w-[10rem] truncate" title={o.failedReason}>{o.failedReason}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">{o.toEmail || "—"}</TableCell>
                      <TableCell className="text-xs text-zinc-500">{relativeDate(o.sentAt ?? o.createdAt)}</TableCell>
                      <TableCell>
                        <OutreachStatusActions outreachId={o.id} status={o.status ?? "draft"} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
