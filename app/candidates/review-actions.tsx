"use client"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import { useTransition } from "react"
import { approveCandidate, rejectCandidate } from "./actions"
import { useRouter } from "next/navigation"

export function ReviewActions({ candidateId }: { candidateId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="flex gap-2 shrink-0">
      <Button
        variant="success"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => {
          await approveCandidate(candidateId)
          router.refresh()
        })}
      >
        <Check className="h-4 w-4" /> Approve
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => {
          await rejectCandidate(candidateId)
          router.refresh()
        })}
      >
        <X className="h-4 w-4" /> Reject
      </Button>
    </div>
  )
}
