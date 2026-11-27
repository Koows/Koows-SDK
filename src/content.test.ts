import test from "node:test"
import assert from "node:assert/strict"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { parsePage, parseQuery, validSlug, safeLink, safeImage, safeEmbed, prepareDocument, jsonLd, sizedImage, srcSet, legacySlug } from "./content.ts"
import { renderContent } from "./renderer.ts"
import type { TipTapNode } from "./content.ts"

const html = (nodes: TipTapNode[]) => renderToStaticMarkup(h("article", {}, renderContent(nodes)))
const heading = (text: string, level = 2): TipTapNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] })

test("slug and tag boundaries accept real Koows slugs, reject traversal and oversized values", () => {
  for (const value of ["first-post", "a", "a".repeat(200), "Express.js", "Claude-Code", "jio-launches-jiocoin:-a-step"]) assert.equal(validSlug(value), true)
  for (const value of ["", "../post", ".hidden", "a/b", "a?b", "a%2Fb", "a b", "a".repeat(201), null, ["post"]]) assert.equal(validSlug(value), false)
})
test("page accepts only integer strings 1..1000 and defaults to 1", () => {
  assert.equal(parsePage(), 1)
  assert.equal(parsePage("1000"), 1000)
  for (const page of ["0", "1001", "-1", "01", "1.5", "1e2", " 2", "", ["2"], null, 2]) assert.equal(parsePage(page), null)
})
test("links allow web, email, fragments and relative paths; unsafe schemes are dropped", () => {
  for (const value of ["https://example.com/", "http://example.com/", "mailto:a@example.com", "/blog", "../guide", "guide?q=x", "#intro"]) assert.ok(safeLink(value))
  for (const value of ["javascript:alert(1)", "data:text/html,test", "java\nscript:alert(1)", "//evil.test", "/\\evil.test", " https://evil.test", "https://user:password@example.com", "vbscript:test"]) assert.equal(safeLink(value), undefined)
})
test("renderer drops dangerous links and images, escapes text and locks external links", () => {
  const result = html([
    { type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "safe", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    { type: "image", attrs: { src: "data:image/svg+xml,test" } },
  ])
  assert.doesNotMatch(result, /javascript:|<script>|<img/)
  assert.match(result, /&lt;script&gt;/)
  assert.match(result, /target="_blank" rel="noopener noreferrer nofollow"/)
  assert.equal(safeImage("//example.com/a.jpg"), undefined)
  assert.equal(safeImage("https://example.com/a.jpg"), "https://example.com/a.jpg")
})
test("only HTTPS YouTube/Vimeo player embeds survive rendering", () => {
  const valid = ["https://www.youtube.com/embed/abc-123", "https://www.youtube-nocookie.com/embed/abc", "https://player.vimeo.com/video/123"]
  for (const src of valid) assert.match(html([{ type: "embed", attrs: { src } }]), /<iframe.*loading="lazy"/)
  for (const src of ["http://www.youtube.com/embed/abc", "https://youtube.com.evil.test/embed/abc", "https://evil.test/embed/abc", "https://www.youtube.com/watch?v=abc", "https://player.vimeo.com/video/bad", "javascript:alert(1)"]) {
    assert.equal(safeEmbed(src), undefined)
    assert.doesNotMatch(html([{ type: "embed", attrs: { src } }]), /iframe/)
  }
})
test("unknown nodes are ignored, including their content", () => {
  assert.equal(html([{ type: "unknown", content: [{ type: "text", text: "hidden" }] }]), "<article></article>")
})
test("headings are stable and unique even with natural suffix collisions; duplicate title is skipped", () => {
  const doc = { type: "doc", content: [heading("Title", 1), heading("Hello!"), heading("Hello!", 3), heading("Hello 2"), heading("你好"), heading("你好"), heading("Deep", 4)] }
  const first = prepareDocument(doc, "Title")
  assert.deepEqual(first, prepareDocument(doc, "Title"))
  assert.deepEqual(first.toc.map(item => item.id), ["hello", "hello-2", "hello-2-2", "section", "section-2"])
  assert.deepEqual(first.toc.map(item => item.level), [2, 3, 2, 2, 2])
  const result = html(first.content)
  for (const item of first.toc) assert.ok(result.includes(`id="${item.id}"`))
  assert.doesNotMatch(result, /<h1|>Title</)
  assert.equal(doc.content.length, 7)
})
test("nonmatching h1 is preserved as h2 and empty documents are safe", () => {
  assert.match(html(prepareDocument({ type: "doc", content: [heading("Other", 1)] }, "Title").content), /<h2/)
  assert.deepEqual(prepareDocument(null, "Title"), { content: [], toc: [] })
})
test("tables, marks, FAQ, lists and code render as escaped React elements", () => {
  const result = html([
    { type: "paragraph", content: [{ type: "text", text: "style", marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "code" }] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "text", text: "Name" }] }, { type: "tableCell", content: [{ type: "text", text: "Value" }] }] }] },
    { type: "faq", attrs: { items: [{ question: "Why?", answer: "<b>Answer</b>" }, { question: 4 }] } },
    { type: "codeBlock", attrs: { language: "html" }, content: [{ type: "text", text: "<script>bad()</script>" }] },
    { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }] },
  ])
  for (const pattern of [/<strong>style<\/strong>/, /scope="col"/, /<details>/, /&lt;b&gt;Answer/, /Copy code/, /<pre>/, /<ol>/]) assert.match(result, pattern)
  assert.doesNotMatch(result, /<script>/)
})
test("JSON-LD cannot terminate its script element", () => {
  assert.equal(jsonLd({ text: "</script><script>" }), '{"text":"\\u003c/script>\\u003cscript>"}')
})

test("search query accepts bounded strings, trims whitespace and rejects duplicate parameters", () => {
  assert.equal(parseQuery(), "")
  assert.equal(parseQuery("  store tips  "), "store tips")
  assert.equal(parseQuery("a".repeat(200)), "a".repeat(200))
  for (const input of ["a".repeat(201), ["one", "two"], null, 4]) assert.equal(parseQuery(input), null)
})

test("Bunny images get a width; other hosts and bad URLs are left alone", () => {
  assert.equal(sizedImage("https://img.koows.com/story/a.png", 960), "https://img.koows.com/story/a.png?width=960")
  assert.equal(sizedImage("https://img.koows.com/story/a.png?width=100", 480), "https://img.koows.com/story/a.png?width=480")
  assert.equal(sizedImage("https://example.com/a.png", 960), "https://example.com/a.png")
  assert.equal(sizedImage("not a url", 960), "not a url")
  assert.equal(srcSet("https://img.koows.com/a.png", [480, 960]), "https://img.koows.com/a.png?width=480 480w, https://img.koows.com/a.png?width=960 960w")
})

test("legacySlug strips the old 5-char Koows suffix", () => {
  assert.equal(legacySlug("8-best-ecommerce-website-builders-in-india-2026-comparison-laaf4"), "8-best-ecommerce-website-builders-in-india-2026-comparison")
  assert.equal(legacySlug("a"), null)
  assert.equal(legacySlug("abcde"), null)
})
