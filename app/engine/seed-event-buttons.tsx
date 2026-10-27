"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logSeedEvent } from "./actions"

// Manual adapter for channels without a permitted send/inbox API.
export function SeedEventButtons({ seedTestId, channel, missing }: { seedTestId: string; channel: string; missing: string[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  const log = (type: "sent" | "reply") => start(async () => { await logSeedEvent(seedTestId, channel, type); router.refresh() })
  return (
    <div className="flex gap-1">
      {missing.includes("sent") && <Button size="sm" variant="outline" disabled={pending} onClick={() => log("sent")}>I sent it</Button>}
      {missing.includes("reply") && !missing.includes("sent") && <Button size="sm" variant="outline" disabled={pending} onClick={() => log("reply")}>Reply received</Button>}
    </div>
  )
}
