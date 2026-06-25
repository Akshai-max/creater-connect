import { db } from "@/lib/db"
import { creators } from "@/lib/db/schema"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar } from "@/components/avatar"
import Link from "next/link"
import { ChevronLeft, AlertTriangle } from "lucide-react"
import { HandleEdit } from "../[id]/handle-edit"

export const dynamic = "force-dynamic"

function isJunkHandle(h: string | null | undefined): boolean {
  const v = (h ?? "").replace("@", "").trim().toLowerCase()
  if (!v) return false // no handle isn't junk, just missing
  if (v.length < 3) return true
  if (v.includes("@")) return true
  if (v.includes(".com") || v.includes(".net") || v.includes(".org")) return true
  if (["ps", "reel", "gmail", "hotmail", "yahoo"].includes(v)) return true
  return false
}

export default async function FixHandlesPage() {
  const all = await db.select().from(creators)
  const junk = all.filter((c) => isJunkHandle(c.handle))
  const missing = all.filter((c) => !(c.handle ?? "").trim() && (c.platform ?? "").toLowerCase() === "ig")

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      <Link href="/creators" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to roster
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Fix handles</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {junk.length} junk handles · {missing.length} missing handles · these creators won't get avatars or auto-enrichment until fixed
        </p>
      </div>

      {junk.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Junk handles ({junk.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {junk.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center gap-4">
                    <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link href={`/creators/${c.id}`} className="text-sm font-medium hover:underline">{c.name}</Link>
                      <div className="text-xs text-zinc-500">{c.id} · current: <span className="font-mono text-amber-600">{c.handle}</span></div>
                    </div>
                    <HandleEdit creatorId={c.id} currentHandle={c.handle} currentPlatform={c.platform} profileUrl={c.profileUrl} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {missing.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Missing handles ({missing.length})</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {missing.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center gap-4">
                    <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link href={`/creators/${c.id}`} className="text-sm font-medium hover:underline">{c.name}</Link>
                      <div className="text-xs text-zinc-500">{c.id} · {c.location ?? "—"}</div>
                    </div>
                    <HandleEdit creatorId={c.id} currentHandle={c.handle} currentPlatform={c.platform} profileUrl={c.profileUrl} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {junk.length === 0 && missing.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center text-sm text-zinc-500">
            🎉 All handles look clean.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
