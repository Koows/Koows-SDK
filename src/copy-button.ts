"use client"

import { createElement as h, useState } from "react"

export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [message, setMessage] = useState(label)
  return h("button", {
    type: "button", className: "blog-copy", "aria-label": label,
    onClick: async () => {
      try { await navigator.clipboard.writeText(text); setMessage("Copied!") }
      catch { setMessage("Could not copy. Select and copy manually.") }
    },
  }, h("span", { "aria-live": "polite" }, message))
}
