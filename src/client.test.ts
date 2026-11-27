import test from "node:test"
import assert from "node:assert/strict"
import { createKoows, nextBlogCache } from "./client.ts"

const blog = createKoows({ publicationHost: "blog.example.com", requestInit: nextBlogCache })
const { getStory, getStories, getRelated, searchStories, getSitemapStories } = blog

const story = { id: 1, title: "A story", slug: "a-story", excert: "An excerpt", publishing_time: "2026-10-01T00:00:00Z", stories_tags: [] }
const list = { total: 1, totalPages: 1, currentPage: 1, stories: [story] }

test("status:0 retry succeeds using distinct cache keys and publication headers", async t => {
  const urls: string[] = []
  t.mock.method(globalThis, "fetch", async (input: URL, options: RequestInit & { next: unknown }) => {
    urls.push(input.href)
    assert.equal(new Headers(options.headers).get("x-auth-token"), "blog.example.com")
    assert.deepEqual(options.next, { revalidate: urls.length === 1 ? 600 : 60, tags: ["blog"] })
    assert.equal((options as RequestInit).cache, undefined)
    return Response.json(urls.length === 1 ? { status: 0 } : { status: 1, story })
  })
  assert.equal((await getStory("a-story"))?.id, 1)
  assert.equal(urls.length, 2)
  assert.notEqual(urls[0], urls[1])
})
test("plain fetch works without Next cache options", async t => {
  const plain = createKoows({ publicationHost: "blog.example.com" })
  t.mock.method(globalThis, "fetch", async (_input: URL, options: RequestInit & { next?: unknown }) => {
    assert.equal(options.next, undefined)
    return Response.json({ status: 1, story })
  })
  assert.equal((await plain.getStory("a-story"))?.id, 1)
})
test("HTTP failure then success retries too", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? new Response("", { status: 503 }) : Response.json({ status: 1, story }))
  assert.equal((await getStory("a-story"))?.title, "A story")
  assert.equal(calls, 2)
})
test("persistent status:0 exhausts four attempts, then checks the listing before absence", async t => {
  const urls: string[] = []
  t.mock.method(globalThis, "fetch", async (input: URL) => { urls.push(input.href); return Response.json(input.pathname.includes("/stories") ? list : { status: 0 }) })
  assert.equal(await getStory("missing"), null)
  assert.equal(urls.filter(u => u.includes("/story/")).length, 4)
  assert.equal(urls.filter(u => u.includes("/stories")).length, 1)
})
test("a post that is still listed throws instead of becoming a cached 404", async t => {
  t.mock.method(globalThis, "fetch", async (input: URL) => Response.json(input.pathname.includes("/stories") ? list : { status: 0 }))
  await assert.rejects(getStory("a-story"), /temporarily unavailable/)
})
test("absence stays null when the listing is unavailable too", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 503 }))
  assert.equal(await getStory("a-story"), null)
})
test("invalid route values never reach fetch", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Should not fetch") })
  assert.equal(await getStory("../secret"), null)
  for (const page of [0, -1, 1001, 1.2]) assert.equal(await getStories(page), null)
  assert.equal(await getStories(1, "../bad"), null)
  assert.deepEqual(await getRelated(-1), [])
  assert.deepEqual(await searchStories("a".repeat(201)), [])
  assert.equal(mock.mock.callCount(), 0)
  assert.throws(() => createKoows({ publicationHost: "" }), /apiKey or publicationHost/)
})
test("lists validate payloads and network failures return safe empty results", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(list))
  assert.equal((await getStories())?.stories[0].slug, "a-story")
  t.mock.method(globalThis, "fetch", async () => Response.json({ stories: [{ ...story, publishing_time: "invalid" }] }))
  assert.equal(await getStories(), null)
  assert.deepEqual(await getRelated(1), [])
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline") })
  assert.equal(await getStories(), null)
  assert.deepEqual(await searchStories("test"), [])
  assert.deepEqual(await getRelated(1), [])
})
test("tag and search endpoints encode their query; optional related results are safe", async t => {
  const urls: URL[] = []
  t.mock.method(globalThis, "fetch", async (url: URL) => { urls.push(url); return Response.json({ ...list, tag: { id: 1, tag: "News", slug: "news" } }) })
  assert.equal((await getStories(2, "news"))?.tag?.tag, "News")
  assert.equal(urls[0].pathname.endsWith("/tagged/news"), true)
  assert.equal(urls[0].searchParams.get("page"), "2")
  assert.equal((await searchStories("a & b"))[0].id, 1)
  assert.equal(urls[1].searchParams.get("search"), "a & b")
  t.mock.method(globalThis, "fetch", async () => Response.json({}))
  assert.deepEqual(await getRelated(1), [])
})
test("sitemap fetches at most 50 pages and discards partial results on failure", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ ...list, totalPages: 100 }) })
  assert.equal((await getSitemapStories()).length, 1)
  assert.equal(calls, 50)
  calls = 0
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ ...list, totalPages: 2 }) : new Response("", { status: 500 }))
  assert.deepEqual(await getSitemapStories(), [])
  assert.equal(calls, 2)
})

test("live detail shape normalizes numeric index flags and an omitted excerpt", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: 1, story: { ...story, excert: undefined, seo_description: "SEO excerpt", allow_index: 1 } }))
  const indexed = await getStory("a-story")
  assert.equal(indexed?.allow_index, true)
  assert.equal(indexed?.excert, "SEO excerpt")
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: 1, story: { ...story, allow_index: 0 } }))
  assert.equal((await getStory("a-story"))?.allow_index, false)
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: 1, story: { ...story, allow_index: false } }))
  assert.equal((await getStory("a-story"))?.allow_index, false)
})
test("one malformed story or tag is dropped instead of blanking the list", async t => {
  const tagged = { ...story, slug: "Express.js-guide", stories_tags: [{ tags: { tag: "Express.js", slug: "Express.js" } }, { tags: { tag: "bad", slug: "a/b" } }] }
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...list, stories: [{ ...story, slug: "../x" }, tagged] }))
  const data = await getStories()
  assert.deepEqual(data?.stories.map(s => s.slug), ["Express.js-guide"])
  assert.deepEqual(data?.stories[0].stories_tags.map(({ tags }) => tags.slug), ["Express.js"])
})
test("tag with 0 Koows results falls back to the posts' own full tag lists", async t => {
  const tagged = { tag: { id: 278, tag: "Small Business", slug: "small-business" }, total: 0, totalPages: 0, currentPage: 1, stories: [] }
  const other = { ...story, id: 2, slug: "other-story" }
  const full = (s: typeof story, slugs: string[]) => ({ status: 1, story: { ...s, stories_tags: slugs.map(slug => ({ tags: { tag: slug, slug } })) } })
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    const path = url.pathname
    if (path.endsWith("/tagged/small-business")) return Response.json(tagged)
    if (path.endsWith("/stories")) return Response.json({ total: 2, totalPages: 1, currentPage: 1, stories: [story, other] })
    if (path.endsWith("/story/a-story")) return Response.json(full(story, ["guides", "small-business"]))
    return Response.json(full(other, ["guides"]))
  })
  const data = await getStories(1, "small-business")
  assert.deepEqual(data?.stories.map(s => s.slug), ["a-story"])
  assert.equal(data?.total, 1)
  assert.equal(data?.tag?.tag, "Small Business")
})

test("apiKey is sent as a bearer token and refused in a browser", async t => {
  const keyed = createKoows({ apiKey: "kpub_live_abc.secret" })
  t.mock.method(globalThis, "fetch", async (_input: URL, options: RequestInit) => {
    const headers = new Headers(options.headers)
    assert.equal(headers.get("authorization"), "Bearer kpub_live_abc.secret")
    assert.equal(headers.get("x-auth-token"), null)
    return Response.json({ status: 1, story })
  })
  assert.equal((await keyed.getStory("a-story"))?.id, 1)
  const g = globalThis as { window?: unknown }
  g.window = {}
  try { assert.throws(() => createKoows({ apiKey: "k" }), /server/) } finally { delete g.window }
})
