"use server"
import { revalidatePath } from "next/cache"
import { logManualEvent } from "@/lib/leads/seed-repo"

export async function logSeedEvent(seedTestId: string, channel: string, type: "sent" | "reply") {
  if (!["email", "linkedin", "instagram"].includes(channel)) throw new Error("bad channel")
  await logManualEvent(seedTestId, channel, type, "logged from dashboard")
  revalidatePath("/engine")
}
