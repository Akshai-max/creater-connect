// FICTIONAL fixture rows in the CSV input format. Not real creators: every
// name says "Fixture", ids contain FIXTURE, evidence lives on example.com.
// Dates are relative to FIXTURE_NOW so tests are deterministic.
export const FIXTURE_NOW = new Date("2026-10-27T12:00:00Z")

const daysAgo = (n: number) => new Date(FIXTURE_NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)
const ytId = (n: number) => `UCFIXTURE${String(n).padStart(15, "0")}` // UC + 22 chars

function items(count: number, opts: { longform?: number; startDay?: number; step?: number; slug: string }) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({
      url: `https://www.youtube.com/watch?v=${opts.slug}${i}`,
      title: `Fixture ${opts.slug} episode ${count - i}: workflow notes`,
      publishedAt: daysAgo((opts.startDay ?? 1) + i * (opts.step ?? 3)),
      isLongform: i < (opts.longform ?? 0),
    })
  }
  return JSON.stringify(out)
}

export const base = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  creator_name: `Fixture Creator ${n}`,
  creator_segment: "video_podcaster",
  entity_type: "individual",
  country_iso2: "US",
  country_evidence_url: `https://example.com/fixture${n}/about`,
  primary_language: "en",
  primary_platform: "youtube",
  profile_url: `https://www.youtube.com/channel/${ytId(n)}`,
  stable_creator_id: ytId(n),
  followers_or_subscribers: 42000 + n,
  content_items: items(4, { longform: 3, slug: `fx${n}v` }),
  monetization_signal: "sponsorship",
  monetization_evidence_url: `https://example.com/fixture${n}/sponsors`,
  incubrix_need: "repurposing",
  need_signal_text: "you are looking for help turning episodes into clips",
  need_evidence_url: `https://example.com/fixture${n}/hiring-editor`,
  email: `fixture${n}@example.com`,
  email_evidence_url: `https://example.com/fixture${n}/contact`,
  email_last_active: daysAgo(5),
  email_source: "published",
  email_business_use: "yes",
  linkedin_url: `https://www.linkedin.com/in/fixture-creator-${n}`,
  linkedin_evidence_url: `https://example.com/fixture${n}/links`,
  linkedin_last_active: daysAgo(10),
  linkedin_source: "published",
  linkedin_business_use: "yes",
  instagram_handle: `@fixture_creator_${n}`,
  instagram_evidence_url: `https://example.com/fixture${n}/links`,
  instagram_last_active: daysAgo(3),
  instagram_source: "published",
  instagram_business_use: "yes",
  checked_date: daysAgo(1),
  source: "fixture",
  ...over,
})

export const FIXTURE_ROWS: Record<string, unknown>[] = [
  base(1),
  base(2, { country_iso2: "GB", creator_segment: "podcaster", content_items: items(2, { longform: 2, startDay: 10, step: 20, slug: "fx2v" }), linkedin_url: "" }),
  base(3, { country_iso2: "CA", creator_segment: "youtuber", content_items: items(9, { longform: 0, step: 3, slug: "fx3v" }), email: "", instagram_handle: "" }),
  base(4, { entity_type: "agency", creator_name: "Fixture Talent Agency" }),
  base(5, { country_iso2: "DE" }),
  base(6, { monetization_evidence_url: "" }),
  base(7, { email_source: "guessed" }),
  base(1, { creator_name: "Fixture Creator 1 (dupe row)" }),
  base(9, { content_items: items(2, { longform: 1, startDay: 5, step: 40, slug: "fx9v" }) }),
  base(10, { stable_creator_id: "" }),
  base(11, { country_iso2: "AU", creator_segment: "expert_creator", monetization_signal: "course" }),
  base(12, { country_iso2: "SG", monetization_evidence_url: "not-a-url" }),
]

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n"
}

export const FIXTURE_SENDER = { name: "Test Sender", role: "Growth Engineer", company: "IncuBrix", website: "https://example.com", postalAddress: "1 Example Street, Example City" }
