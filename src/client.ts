import { z } from "zod"
import { validSlug } from "./content.ts"
import type { TipTapNode } from "./content.ts"

const tagSchema = z.object({ tag: z.string(), slug: z.string().refine(validSlug) })
// One malformed item from the API must not blank the whole list: drop it instead.
const lenient = <T extends z.ZodTypeAny>(item: T) => z.array(z.unknown()).transform(items =>
  items.flatMap(value => { const r = item.safeParse(value); return r.success ? [r.data as z.infer<T>] : [] }))
const storySchema = z.object({
  id: z.number().int().positive(), title: z.string(), slug: z.string().refine(validSlug),
  excert: z.string().nullish().transform(value => value || ""),
  publishing_time: z.string().refine(value => Number.isFinite(Date.parse(value))),
  featured_image: z.string().nullish(),
  read_time: z.object({ minute: z.number().nonnegative(), second: z.number().nonnegative().optional(), wordCount: z.number().optional() }).nullish(),
  users: z.object({ id: z.number().optional(), name: z.string(), username: z.string().optional(), image: z.string().nullish() }).nullish(),
  stories_tags: lenient(z.object({ tags: tagSchema })).default([]),
})
const nodeSchema: z.ZodType<TipTapNode> = z.lazy(() => z.object({
  type: z.string(), text: z.string().optional(), attrs: z.record(z.unknown()).optional(),
  marks: z.array(z.object({ type: z.string(), attrs: z.record(z.unknown()).optional() })).optional(),
  content: z.array(nodeSchema).optional(),
}))
const detailSchema = storySchema.extend({
  editor: nodeSchema.nullish(), editor_version: z.number().nullish(),
  seo_title: z.string().nullish(), seo_description: z.string().nullish(),
  cover_image: z.string().nullish(), modified_date: z.string().nullish(), allow_index: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullish().transform(value => value == null ? undefined : value === true || value === 1),
}).transform(story => ({ ...story, excert: story.excert || story.seo_description || "" }))
const listSchema = z.object({
  total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), currentPage: z.number().int().positive(),
  stories: lenient(storySchema), tag: tagSchema.extend({ id: z.number().optional() }).optional(),
})
export type Story = z.infer<typeof storySchema>
export type StoryDetail = z.infer<typeof detailSchema>
export type StoryList = z.infer<typeof listSchema>

export type KoowsRequestInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } }

export type KoowsOptions = {
  /** Read-only site key from Settings → API Tokens. Server-side only: never expose it to the browser. */
  apiKey?: string
  /** Verified publication domain (host or host/path), sent as x-auth-token. Needed only without apiKey. */
  publicationHost?: string
  /** Publication API base. Default "https://api.koows.com/p/". */
  apiUrl?: string
  /** Extra fetch options per attempt. Next.js apps pass nextBlogCache. */
  requestInit?: (attempt: number) => KoowsRequestInit
}

/** Cache main-site uses: 10 minutes, 60s on a retry, tag "blog". Pass as requestInit. */
export function nextBlogCache(attempt: number): KoowsRequestInit {
  return { next: { revalidate: attempt ? 60 : 600, tags: ["blog"] } }
}

export function createKoows(options: KoowsOptions) {
  // The key is a secret: refuse to run where it would ship to visitors.
  if (options.apiKey && typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error("koows: apiKey must only be used on the server")
  }
  if (!options.apiKey && !options.publicationHost) throw new Error("apiKey or publicationHost is required")
  const base = options.apiUrl || "https://api.koows.com/p/"

  async function request(path: string, attempt = 0): Promise<unknown> {
    const url = new URL(path, base.endsWith("/") ? base : `${base}/`)
    // Distinct retry URLs avoid replaying a cached status:0 response (including fetch memoization),
    // and retries use a 60s cache so a flaky status:0 answer is not stored for 10 minutes.
    if (attempt) url.searchParams.set("_retry", String(attempt))
    const extra = options.requestInit?.(attempt) ?? {}
    const headers = new Headers(extra.headers)
    if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`)
    if (options.publicationHost) headers.set("x-auth-token", options.publicationHost)
    const response = await fetch(url, {
      ...extra,
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error("Publication unavailable")
    return response.json()
  }

  async function getStories(page = 1, tag?: string): Promise<StoryList | null> {
    if (!Number.isInteger(page) || page < 1 || page > 1000 || (tag !== undefined && !validSlug(tag))) return null
    let list: StoryList | null
    try { list = listSchema.parse(await request(tag ? `tagged/${encodeURIComponent(tag)}?page=${page}` : `stories?page=${page}`)) }
    catch { return null }
    if (!tag || list.total > 0) return list
    // Koows resolves a tag slug globally: when another publication owns an older tag with the same slug,
    // tagged/{slug} returns that tag and 0 of our posts. Fall back to matching our posts' own tags.
    // The list endpoint only includes 2 tags per post, so read each post's full tags.
    // shortcut: scans the newest 40 posts, move to a Koows-side fix (publication-scoped tags) when the blog grows.
    const recent = (await getSitemapStories()).slice(0, 40)
    const details = await Promise.all(recent.map(story => getStory(story.slug).catch(() => null)))
    const matches = details.filter((story): story is StoryDetail => !!story?.stories_tags.some(({ tags }) => tags.slug === tag))
    const totalPages = Math.ceil(matches.length / 10)
    return { ...list, total: matches.length, totalPages, currentPage: page, stories: matches.slice((page - 1) * 10, page * 10) }
  }

  async function getStory(slug: string): Promise<StoryDetail | null> {
    if (!validSlug(slug)) return null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = z.object({ status: z.literal(1), story: detailSchema }).safeParse(await request(`story/${encodeURIComponent(slug)}`, attempt))
        if (data.success) return data.data.story
      } catch { /* Retry transient publication failures as well as status:0. */ }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)))
    }
    // Koows' story endpoint sometimes answers "not found" for live posts.
    // If the post is still listed, throw so ISR keeps the last good page instead of caching a noindex 404.
    if ((await getSitemapStories()).some(story => story.slug === slug)) throw new Error("Story temporarily unavailable")
    return null
  }

  async function getRelated(id: number): Promise<Story[]> {
    if (!Number.isSafeInteger(id) || id < 1) return []
    try { return z.object({ stories: lenient(storySchema).optional() }).parse(await request(`related?story_id=${id}`)).stories || [] }
    catch { return [] }
  }

  async function searchStories(query: string): Promise<Story[]> {
    if (!query.trim() || query.length > 200) return []
    try { return z.object({ stories: lenient(storySchema).optional() }).parse(await request(`search?search=${encodeURIComponent(query)}`)).stories || [] }
    catch { return [] }
  }

  async function getSitemapStories(): Promise<Story[]> {
    const stories: Story[] = []
    for (let page = 1; page <= 50; page++) {
      const data = await getStories(page)
      if (!data) return []
      stories.push(...data.stories)
      if (page >= data.totalPages) break
    }
    return [...new Map(stories.map(story => [story.slug, story])).values()]
  }

  return { getStories, getStory, getRelated, searchStories, getSitemapStories }
}

export type KoowsClient = ReturnType<typeof createKoows>
