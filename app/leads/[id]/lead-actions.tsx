"use client"
import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Download, FilePlus2, UserPlus } from "lucide-react"
import { addLeadToPipeline, draftSequencesFor } from "../actions"

export function LeadActions({ leadId, qualified, hasCreator, hasMessages }: { leadId: string; qualified: boolean; hasCreator: boolean; hasMessages: boolean }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {hasMessages && (
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/export/messages?lead=${leadId}`}><Download className="h-3.5 w-3.5" /> Export drafts</a>
          </Button>
        )}
        {!hasMessages && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await draftSequencesFor(leadId); router.refresh() })}>
            <FilePlus2 className="h-3.5 w-3.5" /> Draft messages
          </Button>
        )}
        {qualified && !hasCreator && (
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            try { const id = await addLeadToPipeline(leadId); router.push(`/creators/${id}`) } catch (e) { setErr((e as Error).message) }
          })}>
            <UserPlus className="h-3.5 w-3.5" /> Add to pipeline
          </Button>
        )}
      </div>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
