"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { markReplied, markCold } from "./actions"
import { Button } from "@/components/ui/button"

export function OutreachStatusActions({ outreachId, status }: { outreachId: string; status: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  if (status === "replied") return <span className="text-xs text-emerald-600">✓ replied</span>
  if (status === "cold") return <span className="text-xs text-zinc-500">cold</span>
  return (
    <div className="flex gap-1">
      <Button
        variant="success"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => { await markReplied(outreachId); router.refresh() })}
      >Replied</Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => { await markCold(outreachId); router.refresh() })}
      >Cold</Button>
    </div>
  )
}
