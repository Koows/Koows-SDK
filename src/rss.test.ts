import test from "node:test"
import assert from "node:assert/strict"
import { buildRss, escapeXml, type RssChannel } from "./rss.ts"

const channel: RssChannel = {
  title: "MyCatalog Blog",
  link: "https://mycatalog.io/blog",
  description: "Tips and guides.",
  self: "https://mycatalog.io/blog/rss.xml",
}

test("RSS escapes all XML metacharacters and strips invalid XML controls", () => {
  assert.equal(escapeXml('<&>"\'\u0001'), "&lt;&amp;&gt;&quot;&apos;")
  const xml = buildRss([{ id: 1, title: "A & B <test>", slug: "a-story", excert: "</description><script>bad</script>", publishing_time: "2026-10-01T00:00:00Z", stories_tags: [{ tags: { tag: "A & B", slug: "a-b" } }] }], channel)
  assert.match(xml, /<title>A &amp; B &lt;test&gt;<\/title>/)
  assert.match(xml, /&lt;\/description&gt;&lt;script&gt;/)
  assert.match(xml, /<category>A &amp; B<\/category>/)
  assert.match(xml, /Thu, 01 Oct 2026 00:00:00 GMT/)
  assert.doesNotMatch(xml, /<script>/)
})
test("RSS handles empty lists and limits items to 20", () => {
  assert.doesNotMatch(buildRss([], channel), /<item>/)
  const story = { id: 1, title: "Title", slug: "title", excert: "", publishing_time: "2026-10-01", stories_tags: [] }
  assert.equal((buildRss(Array(30).fill(story), channel).match(/<item>/g) || []).length, 20)
})
