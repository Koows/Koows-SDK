import { createElement as h, type ReactNode } from "react"
import { CopyButton } from "./copy-button.ts"
import { nodeText, safeEmbed, safeImage, safeLink } from "./content.ts"
import type { TipTapNode } from "./content.ts"

export function renderContent(nodes: TipTapNode[]): ReactNode {
  return nodes.map((node, key) => {
    const children = () => renderContent(node.content || [])
    switch (node.type) {
      case "text": {
        let text: ReactNode = node.text || ""
        for (const mark of node.marks || []) {
          if (["bold", "italic", "underline", "code"].includes(mark.type)) {
            const tag = { bold: "strong", italic: "em", underline: "u", code: "code" }[mark.type]!
            text = h(tag, {}, text)
          } else if (mark.type === "link") {
            const href = safeLink(mark.attrs?.href)
            if (href) text = h("a", { href, ...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {}) }, text)
          }
        }
        return h("span", { key }, text)
      }
      case "paragraph": return h("p", { key }, children())
      case "heading": {
        const level = Number(node.attrs?.level)
        // The article title owns the only h1, including for nonmatching source h1s.
        const tag = level === 3 ? "h3" : level === 4 ? "h4" : "h2"
        return h(tag, { key, id: typeof node.attrs?.id === "string" ? node.attrs.id : undefined }, children())
      }
      case "bulletList": return h("ul", { key }, children())
      case "orderedList": return h("ol", { key }, children())
      case "listItem": return h("li", { key }, children())
      case "horizontalRule": return h("hr", { key })
      case "hardBreak": return h("br", { key })
      case "blockquote": return h("blockquote", { key }, children())
      case "codeBlock": {
        const code = nodeText(node)
        return h("div", { key, className: "blog-code" },
          h("div", { className: "blog-code-toolbar" }, h("span", {}, typeof node.attrs?.language === "string" ? node.attrs.language : "Code"), h(CopyButton, { text: code })),
          h("pre", {}, h("code", {}, code)))
      }
      case "table": return h("div", { key, className: "blog-table", role: "region", "aria-label": "Article table", tabIndex: 0 }, h("table", {}, h("tbody", {}, children())))
      case "tableRow": return h("tr", { key }, children())
      case "tableHeader": return h("th", { key, scope: "col" }, children())
      case "tableCell": return h("td", { key }, children())
      case "faq": {
        const items = node.attrs?.items
        if (!Array.isArray(items)) return null
        return h("section", { key, className: "blog-faq", "aria-label": "Frequently asked questions" }, items.map((item, index) =>
          item && typeof item.question === "string" && typeof item.answer === "string"
            ? h("details", { key: index }, h("summary", {}, item.question), h("p", {}, item.answer)) : null))
      }
      case "image": {
        const src = safeImage(node.attrs?.src)
        return src ? h("img", { key, src, alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "", loading: "lazy", width: 1200, height: 800 }) : null
      }
      case "embed": {
        const src = safeEmbed(node.attrs?.src)
        return src ? h("iframe", { key, src, title: "Embedded video", loading: "lazy", sandbox: "allow-scripts allow-same-origin allow-presentation", allow: "fullscreen; picture-in-picture", allowFullScreen: true, referrerPolicy: "strict-origin-when-cross-origin" }) : null
      }
      default: return null
    }
  })
}
