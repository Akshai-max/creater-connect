import { ArrowRight, MessageSquare, CheckCircle2, Plus, Sparkles, Mail, FileText, DollarSign, Tag, X } from "lucide-react"

export function ActivityIcon({ type, className = "h-3.5 w-3.5" }: { type: string; className?: string }) {
  switch (type) {
    case "stage_change": return <ArrowRight className={className} />
    case "note": return <MessageSquare className={className} />
    case "task_created": return <Plus className={className} />
    case "task_completed": return <CheckCircle2 className={className} />
    case "candidate_approved": return <Sparkles className={className} />
    case "email_sent":
    case "email_received": return <Mail className={className} />
    case "contract": return <FileText className={className} />
    case "payment": return <DollarSign className={className} />
    case "tag_added": return <Tag className={className} />
    case "tag_removed": return <X className={className} />
    default: return <MessageSquare className={className} />
  }
}
