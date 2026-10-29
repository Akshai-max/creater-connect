import { test } from "node:test"
import assert from "node:assert/strict"
import { Crawler, applyWebsiteContact, classifyUrl, contactPageLinks, extractUrls, findWebsiteContact, pageEmails, parseRobots, type WebFetcher } from "../lib/leads/website-contacts"

// FICTIONAL sites (.test domains) served by a fake fetcher. Nothing here reaches the network.
type Page = { status?: number; body?: string; type?: string; location?: string }
function fakeWeb(pages: Record<string, Page>) {
  const hits: string[] = []
  const fetcher: WebFetcher = async (url) => {
    hits.push(url)
    const p = pages[url] ?? { status: 404, body: "" }
    const headers: Record<string, string> = { "content-type": p.type ?? "text/html" }
    if (p.location) headers.location = p.location
    return { status: p.status ?? 200, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => p.body ?? "" }
  }
  return { fetcher, hits, crawler: () => new Crawler(fetcher, 0, async () => {}) }
}

test("robots.txt: our group beats *, longest match wins, Allow wins ties, wildcards", () => {
  const allowed = parseRobots([
    "User-agent: *", "Disallow: /", "",
    "User-agent: creator-crm-contact-finder", "Disallow: /private", "Allow: /private/contact", "Disallow: /*.pdf$",
  ].join("\n"))
  assert.equal(allowed("/"), true)
  assert.equal(allowed("/private/x"), false)
  assert.equal(allowed("/private/contact"), true)
  assert.equal(allowed("/files/kit.pdf"), false)
  assert.equal(allowed("/files/kit.pdf?x=1"), true)
  assert.equal(parseRobots("User-agent: *\nDisallow: /")("/contact"), false)
  assert.equal(parseRobots("User-agent: *\nDisallow:")("/contact"), true)
})

test("URLs: platforms and shorteners are skipped, link pages and own sites kept", () => {
  assert.deepEqual(extractUrls("Site: https://jane.test/about. Shop https://amzn.to/x, links (https://linktr.ee/jane)"),
    ["https://jane.test/about", "https://amzn.to/x", "https://linktr.ee/jane"])
  assert.equal(classifyUrl("https://www.instagram.com/jane"), "skip")
  assert.equal(classifyUrl("https://bit.ly/abc"), "skip")
  assert.equal(classifyUrl("https://linktr.ee/jane"), "linkpage")
  assert.equal(classifyUrl("https://jane.test/"), "site")
  assert.equal(classifyUrl("https://jane.test/kit.pdf"), "skip")
})

test("page emails: visible and mailto, business context, junk dropped, obfuscated left alone", () => {
  const html = `<html><head><script>var x="tracking@sentry.io"</script></head><body>
    <p>For brand partnerships and sponsorship enquiries: <a href="mailto:Deals@Jane.test?subject=Hi">email me</a></p>
    <p>Fan mail: hello&#64;jane.test</p>
    <footer>noreply@jane.test <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="1a2b3c">[email&#160;protected]</a></footer>
  </body></html>`
  const found = pageEmails(html, "https://jane.test/")
  const deals = found.find((e) => e.email === "deals@jane.test")!
  assert.ok(deals && deals.businessUse && deals.mailto)
  const hello = found.find((e) => e.email === "hello@jane.test")!
  assert.ok(hello && !hello.businessUse)
  assert.ok(!found.some((e) => /sentry|noreply/.test(e.email)))
  assert.equal(found.length, 2)
  // A /contact page counts as business context even without the words.
  assert.equal(pageEmails("<p>hi@jane.test</p>", "https://jane.test/contact")[0].businessUse, true)
})

test("contact page links: same site only, business pages first", () => {
  const html = `<a href="/blog">Blog</a><a href="/about">About</a><a href="/work-with-me">Work with me</a><a href="https://other.test/contact">x</a>`
  assert.deepEqual(contactPageLinks(html, "https://jane.test/"), ["https://jane.test/work-with-me", "https://jane.test/about"])
})

test("finder: link page → own site → contact page, dated by the newest linking video", async () => {
  const web = fakeWeb({
    "https://linktr.ee/robots.txt": { body: "User-agent: *\nAllow: /" },
    "https://linktr.ee/jane": { body: `<a href="https://www.youtube.com/@jane">YouTube</a><a href="https://jane.test/">My site</a>` },
    "https://jane.test/robots.txt": { status: 404 },
    "https://jane.test/": { body: `<a href="/contact">Contact</a>` },
    "https://jane.test/contact": { body: `<h1>Contact</h1><p>Business: team@jane.test</p>` },
  })
  const r = await findWebsiteContact({
    channelDescription: "All my links: https://linktr.ee/jane",
    videos: [
      { url: "https://www.youtube.com/watch?v=a", description: "links https://linktr.ee/jane", publishedAt: "2026-10-20T10:00:00Z" },
      { url: "https://www.youtube.com/watch?v=b", description: "links https://linktr.ee/jane", publishedAt: "2026-09-01T10:00:00Z" },
    ],
    crawler: web.crawler(),
  })
  assert.equal(r.contact?.email, "team@jane.test")
  assert.equal(r.contact?.pageUrl, "https://jane.test/contact")
  assert.equal(r.contact?.businessUse, true)
  assert.equal(r.contact?.lastActive, "2026-10-20T10:00:00Z")
})

test("finder: robots.txt disallow means the page is never fetched", async () => {
  const web = fakeWeb({
    "https://jane.test/robots.txt": { body: "User-agent: *\nDisallow: /" },
    "https://jane.test/": { body: "<p>Business: team@jane.test</p>" },
  })
  const r = await findWebsiteContact({ channelDescription: "https://jane.test/", videos: [], crawler: web.crawler() })
  assert.equal(r.contact, null)
  assert.match(r.reason, /robots\.txt disallows/)
  assert.ok(!web.hits.includes("https://jane.test/"))
})

test("finder: a 5xx robots.txt counts as disallowed; redirects are checked per host", async () => {
  const down = fakeWeb({ "https://jane.test/robots.txt": { status: 503 }, "https://jane.test/": { body: "team@jane.test" } })
  assert.equal((await findWebsiteContact({ channelDescription: "https://jane.test/", videos: [], crawler: down.crawler() })).contact, null)

  const moved = fakeWeb({
    "https://jane.test/robots.txt": { status: 404 },
    "https://jane.test/": { status: 301, location: "https://janebrand.test/" },
    "https://janebrand.test/robots.txt": { body: "User-agent: *\nDisallow: /" },
    "https://janebrand.test/": { body: "Business: team@janebrand.test" },
  })
  const r = await findWebsiteContact({ channelDescription: "https://jane.test/", videos: [], crawler: moved.crawler() })
  assert.equal(r.contact, null)
  assert.ok(!moved.hits.includes("https://janebrand.test/"))
})

test("finder: only links in the creator's own text are visited; none means no lookup", async () => {
  const web = fakeWeb({})
  const r = await findWebsiteContact({ channelDescription: "Follow https://instagram.com/jane", videos: [], crawler: web.crawler() })
  assert.equal(r.contact, null)
  assert.equal(web.hits.length, 0)
})

test("finder: a sponsor linked only in video descriptions isn't treated as the creator's site", async () => {
  const web = fakeWeb({
    "https://sponsorshop.test/robots.txt": { status: 404 },
    "https://sponsorshop.test/": { body: "Business enquiries: orders@sponsorshop.test" },
    "https://janedoe.test/robots.txt": { status: 404 },
    "https://janedoe.test/": { body: "Business enquiries: jane@janedoe.test" },
  })
  const videos = [{ url: "https://www.youtube.com/watch?v=a", description: "Use code JANE at https://sponsorshop.test/", publishedAt: "2026-10-20T10:00:00Z" }]
  const skipped = await findWebsiteContact({ channelDescription: "", videos, crawler: web.crawler(), creatorName: "Jane Doe Business Coach" })
  assert.equal(skipped.contact, null)
  assert.ok(!web.hits.some((u) => u.includes("sponsorshop")))
  const named = await findWebsiteContact({ channelDescription: "", videos: [{ ...videos[0], description: "My site https://janedoe.test/" }], crawler: web.crawler(), creatorName: "Jane Doe Business Coach" })
  assert.equal(named.contact?.email, "jane@janedoe.test")
})

test("finder: a redirect onto a platform stops, and platform addresses are dropped", async () => {
  const web = fakeWeb({
    "https://janedoe.test/robots.txt": { status: 404 },
    "https://janedoe.test/": { status: 302, location: "https://www.patreon.com/press" },
    "https://www.patreon.com/robots.txt": { status: 404 },
    "https://www.patreon.com/press": { body: "Press enquiries: pr@patreon.com" },
  })
  const r = await findWebsiteContact({ channelDescription: "https://janedoe.test/", videos: [], crawler: web.crawler() })
  assert.equal(r.contact, null)
  assert.ok(!web.hits.includes("https://www.patreon.com/press"))
  assert.equal(pageEmails("<p>Business: pr@patreon.com or help@linktr.ee</p>", "https://janedoe.test/").length, 0)
})

test("applying a website contact never overwrites an email and asks for checks", () => {
  const c = { email: "team@jane.test", pageUrl: "https://jane.test/contact", quote: "Business: team@jane.test", businessUse: true, siteUrl: "https://jane.test/", lastActive: null }
  const has = { email: "own@jane.test", review_notes: "" }
  assert.equal(applyWebsiteContact(has, c), false)
  assert.equal(has.email, "own@jane.test")
  const row: Record<string, unknown> = { email: "", review_notes: "CONFIRM: individual creator; FIND: published business contact" }
  assert.equal(applyWebsiteContact(row, c), true)
  assert.equal(row.email_source, "published")
  assert.equal(row.email_business_use, "yes")
  assert.equal(row.email_last_active, "")
  assert.equal(row.email_evidence_url, "https://jane.test/contact")
  assert.doesNotMatch(String(row.review_notes), /FIND: published business contact/)
  assert.match(String(row.review_notes), /fill email_last_active/)
})
