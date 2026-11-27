import type { StoryDetail } from "./client.ts"
import { safeImage, nodeText, type TipTapNode } from "./content.ts"

export type BlogSite = { origin: string; name: string; description: string }

const logo = (site: BlogSite) => `${site.origin}/logo.png`

export function listingMetadata(site: BlogSite, title: string, path: string, description = site.description) {
  return {
    title, description, alternates: { canonical: `${site.origin}${path}`, types: { "application/rss+xml": `${site.origin}/blog/rss.xml` } },
    openGraph: { type: "website" as const, title, description, url: `${site.origin}${path}`, images: [logo(site)] },
    twitter: { card: "summary_large_image" as const, title, description, images: [logo(site)] },
  }
}

export function postMetadata(site: BlogSite, story: StoryDetail) {
  const title = story.seo_title || story.title
  // Koows rewrites seo_description from the first paragraph (cut at 180 chars) on every edit; the excerpt is the hand-written meta description.
  const description = story.excert || story.seo_description
  const url = `${site.origin}/blog/${story.slug}`
  const image = safeImage(story.cover_image) || safeImage(story.featured_image) || logo(site)
  return {
    title, description, alternates: { canonical: url },
    robots: story.allow_index === false ? { index: false, follow: true, googleBot: { index: false, follow: true } } : undefined,
    openGraph: {
      type: "article" as const, title, description, url, publishedTime: story.publishing_time,
      modifiedTime: validDate(story.modified_date) || story.publishing_time,
      authors: [story.users?.name || site.name], images: [image],
    },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] },
  }
}

export function validDate(date: string | null | undefined): string | undefined {
  return date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined
}

export function breadcrumbs(site: BlogSite, items: { name: string; path: string }[]) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({
    "@type": "ListItem", position: index + 1, name: item.name, item: `${site.origin}${item.path}`,
  })) }
}

export function postSchema(site: BlogSite, story: StoryDetail) {
  return {
    "@context": "https://schema.org", "@type": "BlogPosting", headline: story.title,
    description: story.excert || story.seo_description, datePublished: story.publishing_time,
    dateModified: validDate(story.modified_date) || story.publishing_time,
    author: { "@type": "Person", name: story.users?.name || site.name },
    image: safeImage(story.cover_image) || safeImage(story.featured_image) || logo(site),
    mainEntityOfPage: `${site.origin}/blog/${story.slug}`,
    publisher: { "@type": "Organization", name: site.name, logo: { "@type": "ImageObject", url: logo(site) } },
  }
}

const FAQ_HEADING = /\b(faqs?|frequently asked questions)\b/i
const isBoldText = (node: TipTapNode) => node.type === "text" && !!node.marks?.some(mark => mark.type === "bold")

/**
 * FAQPage from the post's own FAQ section, so the markup only claims answers the page shows.
 * Format: an H2 naming FAQ, then paragraphs that open with a bold question,
 * with the answer after it in the same paragraph or in the next one. Null when there is no such section.
 */
export function faqSchema(content: TipTapNode[]) {
  const start = content.findIndex(node => node.type === "heading" && Number(node.attrs?.level) === 2 && FAQ_HEADING.test(nodeText(node)))
  if (start < 0) return null
  const pairs: { q: string; a: string }[] = []
  let pending: string | null = null
  for (const node of content.slice(start + 1)) {
    if (node.type === "heading") break
    if (node.type !== "paragraph" || !node.content?.length) continue
    const lead = node.content.findIndex(child => !(child.type === "text" && !child.text?.trim()))
    if (lead >= 0 && isBoldText(node.content[lead])) {
      let cut = lead
      while (cut < node.content.length && isBoldText(node.content[cut])) cut++
      const q = node.content.slice(lead, cut).map(nodeText).join("").trim()
      const a = node.content.slice(cut).map(nodeText).join("").trim()
      if (a) { pairs.push({ q, a }); pending = null } else pending = q
    } else if (pending) {
      const a = nodeText(node).trim()
      if (a) pairs.push({ q: pending, a })
      pending = null
    }
  }
  const items = pairs.filter(pair => pair.q && pair.a)
  if (!items.length) return null
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(({ q, a }) => ({
    "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a },
  })) }
}

/** The modified date worth showing: valid and at least a day after publishing (same-day fixes are not "updates"). */
export function updatedDate(story: Pick<StoryDetail, "publishing_time" | "modified_date">): string | undefined {
  const modified = validDate(story.modified_date)
  const published = Date.parse(story.publishing_time)
  if (!modified || !Number.isFinite(published)) return undefined
  return Date.parse(modified) - published >= 86_400_000 ? modified : undefined
}
