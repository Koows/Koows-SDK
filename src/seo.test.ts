import test from "node:test"
import assert from "node:assert/strict"
import { listingMetadata, postMetadata, postSchema, breadcrumbs, faqSchema, updatedDate, type BlogSite } from "./seo.ts"
import type { TipTapNode } from "./content.ts"
import type { StoryDetail } from "./client.ts"

const site: BlogSite = { origin: "https://mycatalog.io", name: "MyCatalog", description: "Tips and guides." }
const story: StoryDetail = {
  id: 1, slug: "a-story", title: "A story", excert: "An excerpt", publishing_time: "2026-10-01T00:00:00Z",
  stories_tags: [], allow_index: true,
}

test("listing metadata uses canonical pagination URLs and RSS discovery", () => {
  const data = listingMetadata(site, "Page 2", "/blog/page/2")
  assert.equal(data.alternates?.canonical, "https://mycatalog.io/blog/page/2")
  assert.deepEqual(data.alternates?.types, { "application/rss+xml": "https://mycatalog.io/blog/rss.xml" })
  assert.equal(data.openGraph?.title, "Page 2")
})
test("post SEO falls back to title/excerpt, rejects unsafe images and honors noindex", () => {
  const data = postMetadata(site, { ...story, allow_index: false, cover_image: "javascript:bad" })
  assert.equal(data.title, story.title)
  assert.equal(data.description, story.excert)
  assert.deepEqual(data.robots, { index: false, follow: true, googleBot: { index: false, follow: true } })
  assert.equal(data.alternates?.canonical, "https://mycatalog.io/blog/a-story")
  assert.deepEqual(data.openGraph?.images, ["https://mycatalog.io/logo.png"])
})
test("post SEO uses publication overrides, author, cover and valid modification time", () => {
  const input = { ...story, seo_title: "SEO title", seo_description: "SEO description", users: { name: "Writer" }, cover_image: "https://example.com/cover.jpg", modified_date: "2026-10-02T00:00:00Z" }
  const data = postMetadata(site, input)
  assert.equal(data.title, "SEO title")
  assert.equal(data.description, story.excert, "hand-written excerpt wins over Koows' auto seo_description")
  assert.equal(postMetadata(site, { ...input, excert: "" }).description, "SEO description")
  assert.deepEqual(data.openGraph?.images, [input.cover_image])
  const schema = postSchema(site, input)
  assert.equal(schema.author.name, "Writer")
  assert.equal(schema.dateModified, new Date(input.modified_date).toISOString())
  assert.equal(schema.publisher.logo.url, "https://mycatalog.io/logo.png")
  assert.equal(postSchema(site, { ...story, modified_date: "invalid" }).dateModified, story.publishing_time)
})
test("breadcrumb schema maintains ordered canonical items", () => {
  const schema = breadcrumbs(site, [{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }])
  assert.deepEqual(schema.itemListElement.map(item => [item.position, item.item]), [[1, "https://mycatalog.io/"], [2, "https://mycatalog.io/blog"]])
})

const t = (text: string, bold = false): TipTapNode => ({ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) })
const p = (...content: TipTapNode[]): TipTapNode => ({ type: "paragraph", content })
const h = (text: string, level = 2): TipTapNode => ({ type: "heading", attrs: { level }, content: [t(text)] })

test("FAQ schema reads bold questions with answers in the same or the next paragraph", () => {
  const data = faqSchema([
    h("Intro"), p(t("Body text with a ", false), t("bold word", true)),
    h("Frequently asked questions"),
    p(t("Do I need GST to sell online?", true), t("\nYou need a GSTIN for most interstate sales; confirm with your CA.")),
    p(t("Can I take COD?", true)),
    p(t("Yes. Turn on cash on delivery in payment settings.")),
    p(t("A note without a bold question.")),
    p(t("Question without an answer?", true)),
    h("Start today"), p(t("Is this after the FAQ?", true), t(" It should be ignored.")),
  ])
  assert.ok(data)
  assert.deepEqual(data.mainEntity.map(item => [item.name, item.acceptedAnswer.text]), [
    ["Do I need GST to sell online?", "You need a GSTIN for most interstate sales; confirm with your CA."],
    ["Can I take COD?", "Yes. Turn on cash on delivery in payment settings."],
  ])
  assert.equal(data["@type"], "FAQPage")
})

test("FAQ schema is null without an H2 FAQ section or without any answered question", () => {
  assert.equal(faqSchema([h("Guide"), p(t("Q?", true), t(" A."))]), null)
  assert.equal(faqSchema([h("FAQ", 3), p(t("Q?", true), t(" A."))]), null, "only an H2 starts the FAQ")
  assert.equal(faqSchema([h("FAQs"), p(t("Plain paragraph."))]), null)
  assert.equal(faqSchema([]), null)
  assert.ok(faqSchema([h("FAQs"), p(t("Q?", true), t(" A."))]), "FAQs heading works")
})

test("updated date shows only for a valid edit at least a day after publishing", () => {
  const published = "2026-10-01T00:00:00Z"
  assert.equal(updatedDate({ publishing_time: published, modified_date: null }), undefined)
  assert.equal(updatedDate({ publishing_time: published, modified_date: "not a date" }), undefined)
  assert.equal(updatedDate({ publishing_time: published, modified_date: "2026-10-01T09:00:00Z" }), undefined, "same-day fix")
  assert.equal(updatedDate({ publishing_time: published, modified_date: "2026-10-05T00:00:00Z" }), "2026-10-05T00:00:00.000Z")
})
