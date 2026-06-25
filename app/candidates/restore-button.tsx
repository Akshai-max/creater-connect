"use client"
import { Button } from "@/components/ui/button"
import { Undo2 } from "lucide-react"
import { useTransition } from "react"
import { restoreCandidate } from "./actions"
import { useRouter } from "next/navigation"

export function RestoreButton({ candidateId }: { candidateId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => {
        await restoreCandidate(candidateId)
        router.refresh()
      })}
    >
      <Undo2 className="h-4 w-4" /> Restore
    </Button>
  )
}
