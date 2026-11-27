import { z } from "zod"

export type TipTapNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: TipTapNode[]
}

// Koows slugs include uppercase, "." and ":" (e.g. "Express.js"); no "/", "?", "%" or leading dot.
const slugSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)
const pageSchema = z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).refine(page => page <= 1000)

export function validSlug(value: unknown): value is string {
  return slugSchema.safeParse(value).success
}

export function parsePage(value: unknown = "1"): number | null {
  const result = pageSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseQuery(value: unknown = ""): string | null {
  const result = z.string().max(200).transform(query => query.trim()).safeParse(value)
  return result.success ? result.data : null
}

export function safeImage(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return undefined
  try {
    const url = new URL(value)
    return url.username || url.password ? undefined : url.href
  } catch { return undefined }
}

// img.koows.com is Bunny CDN: ?width resizes, and browsers already get WebP via the Accept header.
export function sizedImage(src: string, width: number): string {
  try {
    const url = new URL(src)
    if (url.hostname !== "img.koows.com") return src
    url.searchParams.set("width", String(width))
    return url.href
  } catch { return src }
}
export const srcSet = (src: string, widths: number[]) => widths.map(w => `${sizedImage(src, w)} ${w}w`).join(", ")

export function safeLink(value: unknown): string | undefined {
  // eslint-disable-next-line no-control-regex -- Browsers strip controls before interpreting URL schemes.
  if (typeof value !== "string" || /[\u0000-\u0020\\]/.test(value)) return undefined
  if (value.startsWith("#")) return value
  if (safeImage(value)) return safeImage(value)
  if (/^mailto:[^:]+$/i.test(value)) return value
  // Reject scheme-relative URLs; relative paths must stay on this site.
  if (!value.startsWith("//") && !/^[^/?#]*:/.test(value)) return value || undefined
  return undefined
}

export function safeEmbed(value: unknown): string | undefined {
  const image = safeImage(value)
  if (!image) return undefined
  const url = new URL(image)
  if (url.protocol !== "https:" || url.port) return undefined
  if (["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) && /^\/embed\/[\w-]+$/.test(url.pathname)) return url.href
  if (url.hostname === "player.vimeo.com" && /^\/video\/\d+$/.test(url.pathname)) return url.href
  return undefined
}

export function nodeText(node: TipTapNode): string {
  return node.type === "text" ? node.text || "" : (node.content || []).map(nodeText).join("")
}

export function prepareDocument(doc: TipTapNode | null | undefined, title: string) {
  const toc: { id: string; text: string; level: number }[] = []
  const used = new Set<string>()
  let content = doc?.type === "doc" ? doc.content || [] : []
  if (content[0]?.type === "heading" && content[0].attrs?.level === 1 && nodeText(content[0]).trim() === title.trim()) content = content.slice(1)
  function visit(node: TipTapNode): TipTapNode {
    const copy = { ...node }
    if (copy.type === "heading") {
      const level = Number(copy.attrs?.level)
      const text = nodeText(copy)
      const base = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section"
      let id = base
      let suffix = 2
      while (used.has(id)) id = `${base}-${suffix++}`
      used.add(id)
      copy.attrs = { ...copy.attrs, id }
      if (level === 2 || level === 3) toc.push({ id, text, level })
    }
    if (copy.content) copy.content = copy.content.map(visit)
    return copy
  }
  return { content: content.map(visit), toc }
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

/** Koows used to append a random 5-char suffix to slugs; returns the clean slug, or null. */
export function legacySlug(slug: string): string | null {
  const clean = slug.replace(/-[a-z0-9]{5}$/, "")
  return clean !== slug && validSlug(clean) ? clean : null
}
