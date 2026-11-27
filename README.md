# koows

Server-side client for [Koows](https://koows.com) publications. Fetch stories, search and tags, render story content to React, and build RSS feeds and SEO metadata for your own site.

Works in any Node.js 18+ server: Next.js (App Router), Remix, Astro, Express, build scripts.

## Install

```bash
npm install koows
```

`react` is only needed if you use `koows/render`.

## Get a site key

1. In Koows, open your publication's **Settings → API Tokens**.
2. Click **New token**, choose **Site read (read-only)** access, and create it.
3. Copy the key (it is shown once) into your server environment:

```bash
# .env — never prefix with NEXT_PUBLIC_ or expose it to the browser
KOOWS_SITE_KEY=kpub_live_xxxx.yyyy
```

The key can only read published content of one publication. Revoke it any time from the same page.

## Usage

```ts
import { createKoows, nextBlogCache, prepareDocument } from "koows"
import { renderContent } from "koows/render"

const blog = createKoows({
  apiKey: process.env.KOOWS_SITE_KEY,
  requestInit: nextBlogCache, // Next.js only: 10 min cache, 60s on retry, tag "blog"
})

const list = await blog.getStories(1)              // page 1, or getStories(1, "tag-slug")
const story = await blog.getStory("a-story")       // null when it does not exist
const related = story ? await blog.getRelated(story.id) : []
const hits = await blog.searchStories("store")
const all = await blog.getSitemapStories()         // every published story, for sitemaps

if (story) {
  const { content, toc } = prepareDocument(story.editor_version === 2 ? story.editor : null, story.title)
  const body = renderContent(content)               // React elements
}
```

Call it only from server code (server components, route handlers, API routes). `createKoows` throws if it runs in a browser with an `apiKey`.

### Without a key

Sites that already use a verified Koows domain can keep identifying the publication by that domain:

```ts
const blog = createKoows({ publicationHost: "blog.example.com" })
```

New self-hosted sites need an `apiKey`.

## API

| Function | Returns |
|---|---|
| `getStories(page, tag?)` | Paged list, or `null` on bad input or API failure |
| `getStory(slug)` | Story with editor content, or `null`. Throws if the story is listed but its detail request keeps failing, so a cached page is kept instead of a 404 |
| `getRelated(id)` | Related stories, `[]` on failure |
| `searchStories(query)` | Matching stories, `[]` on failure |
| `getSitemapStories()` | All published stories, deduplicated |
| `prepareDocument(doc, title)` | `{ content, toc }`: content without a duplicate title, with heading ids |
| `renderContent(nodes)` (`koows/render`) | React elements for TipTap content: headings, lists, code blocks with copy, tables, FAQ, images, embeds |
| `buildRss(stories, channel)` | RSS 2.0 XML string |
| `listingMetadata`, `postMetadata`, `postSchema`, `breadcrumbs`, `faqSchema` | Metadata and JSON-LD for SEO |
| `safeLink`, `safeImage`, `safeEmbed`, `validSlug`, `parsePage`, `parseQuery`, `legacySlug` | Input and URL guards |

Every API response is validated. A malformed item is dropped rather than breaking the page, and network failures return empty results.

## Options

| Option | Description |
|---|---|
| `apiKey` | Read-only site key. Server-side only. |
| `publicationHost` | Verified domain (`host` or `host/path`), for sites without a key. |
| `apiUrl` | API base. Default `https://api.koows.com/p/`. |
| `requestInit` | `(attempt) => RequestInit` added to every fetch. Pass `nextBlogCache` in Next.js. |

Cache invalidation stays in your app, for example `revalidateTag("blog")`.

## License

MIT
