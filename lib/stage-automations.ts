import type { Stage } from "@/lib/stages"

// For a given new stage, return the auto-task to create (if any).
export function autoTaskForStage(newStage: Stage, fromStage: Stage | null): { title: string; body?: string; daysFromNow: number } | null {
  switch (newStage) {
    case "Outreached":
      return { title: "Follow up if no reply", body: "Send a gentle bump if creator hasn't responded.", daysFromNow: 5 }
    case "Replied":
      return { title: "Send brief", body: "Creator replied — share the campaign brief and rate offer.", daysFromNow: 1 }
    case "Negotiating":
      return { title: "Send contract & W9 request", body: "Lock in deliverables and rate; request paperwork.", daysFromNow: 2 }
    case "Briefed":
      return { title: "Check content delivery", body: "Confirm content arrived on time and on-brief.", daysFromNow: 14 }
    case "Content In":
      return { title: "Review content + give feedback", daysFromNow: 1 }
    case "Live":
      return { title: "Confirm post live + screenshot performance", daysFromNow: 2 }
    case "Paid":
      return { title: "Send thank-you + ask about repurpose", daysFromNow: 1 }
    default:
      return null
  }
}

export function dueDateInDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(9, 0, 0, 0) // 9am due
  return d.toISOString()
}
