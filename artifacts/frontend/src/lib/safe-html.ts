// Rich text typed into the app (a goal's description) can only ever carry
// simple formatting. Anything else is dropped before it is shown, so stored
// text can't run script or load anything in another person's browser.

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI"]);

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const children = Array.from(el.childNodes).map((c) => clean(c, doc)).filter((c): c is Node => c !== null);
  if (!ALLOWED.has(el.tagName)) {
    // Keep the words of an unknown element (but never a script's or style's).
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return null;
    const frag = doc.createDocumentFragment();
    children.forEach((c) => frag.appendChild(c));
    return frag;
  }
  const out = doc.createElement(el.tagName.toLowerCase());
  children.forEach((c) => out.appendChild(c));
  return out;
}

/** Simple formatting only: bold, italic, underline, paragraphs, line breaks
 * and lists, with every attribute removed. */
export function safeRichText(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, "");
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const out = doc.createElement("div");
  Array.from(root.childNodes).forEach((c) => {
    const kept = clean(c, doc);
    if (kept) out.appendChild(kept);
  });
  return out.innerHTML;
}
