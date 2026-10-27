"use client"
import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { addLeadToPipeline, draftSequencesFor } from "../actions"

export function LeadActions({ leadId, qualified, hasCreator, hasMessages }: { leadId: string; qualified: boolean; hasCreator: boolean; hasMessages: boolean }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  return (
    <div className="flex gap-2 items-center flex-wrap">
      {!hasMessages && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await draftSequencesFor(leadId); router.refresh() })}>
          Draft 3-channel sequence
        </Button>
      )}
      {qualified && !hasCreator && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          try { const id = await addLeadToPipeline(leadId); router.push(`/creators/${id}`) } catch (e) { setErr((e as Error).message) }
        })}>
          Add to pipeline
        </Button>
      )}
      <a href={`/api/export/messages?lead=${leadId}`} className="text-xs underline text-zinc-500">Export sequences (.md)</a>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
