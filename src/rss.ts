import type { Story } from "./client.ts"

export type RssChannel = { title: string; link: string; description: string; self: string }

export function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these control characters.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!)
}

/** `channel.link` is the blog index with no trailing slash. Item URLs are `${link}/${slug}`. */
export function buildRss(stories: Story[], channel: RssChannel): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${escapeXml(channel.title)}</title><link>${escapeXml(channel.link)}</link>
<description>${escapeXml(channel.description)}</description>
<language>en</language><atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml"/>
${stories.slice(0, 20).map(story => `<item><title>${escapeXml(story.title)}</title><link>${escapeXml(channel.link)}/${escapeXml(story.slug)}</link><guid isPermaLink="true">${escapeXml(channel.link)}/${escapeXml(story.slug)}</guid><description>${escapeXml(story.excert)}</description><pubDate>${new Date(story.publishing_time).toUTCString()}</pubDate>${story.stories_tags.map(({ tags }) => `<category>${escapeXml(tags.tag)}</category>`).join("")}</item>`).join("\n")}
</channel></rss>`
}
