import { db } from "@/lib/db"
import { creators } from "@/lib/db/schema"
import { eq, asc } from "drizzle-orm"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Composer } from "./composer"

export const dynamic = "force-dynamic"

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ creatorId?: string }> }) {
  const params = await searchParams
  const all = await db.select().from(creators).orderBy(asc(creators.name))
  const selected = params.creatorId ? (await db.select().from(creators).where(eq(creators.id, params.creatorId)))[0] : null

  return (
    <div className="px-8 py-8 max-w-3xl mx-auto">
      <Link href="/outreach" className="inline-flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4">
        <ChevronLeft className="h-3 w-3 mr-1" /> Back to outreach
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Compose pitch</h1>
      <Composer
        creators={all.map((c) => ({ id: c.id, name: c.name, handle: c.handle, email: c.email }))}
        initialCreatorId={selected?.id ?? ""}
      />
    </div>
  )
}
