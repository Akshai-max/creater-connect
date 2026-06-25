import { Card, CardContent } from "@/components/ui/card"
import { Megaphone } from "lucide-react"

export default function CampaignsPage() {
  return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Plan and track creator campaigns — coming next.</p>
      </div>
      <Card>
        <CardContent className="p-12 text-center text-sm text-zinc-500">
          <Megaphone className="h-8 w-8 mx-auto mb-3 text-zinc-300 dark:text-zinc-700" />
          <p>Campaign management is on the roadmap. For now, track campaigns in the creator notes.</p>
        </CardContent>
      </Card>
    </div>
  )
}
