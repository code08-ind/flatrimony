#!/usr/bin/env python3
"""
Extracts the four legal pages (W07–W10) from the exported designs in docs/designs/web/<locale>/
into content trees the web app renders (apps/web/content/legal/<page>.<locale>.json).

The text is the design's draft, pending legal review (founder task T0.15): nothing is rewritten.
Only content elements survive (headings, paragraphs, lists, bold/italic, rules); the site chrome
(top bar, breadcrumb, table of contents, sidebar, footer), icons and links' targets are dropped,
so the app never renders HTML from a file.

Business details the design tool made up are shown as placeholders instead (founder rule: never
invent business numbers or claims): the company's legal name, its addresses and contact emails
(the domain is not decided, ADR-0007). The founder fills them in with the legal review (T0.15).

Re-run after the designs or the legal text change:

  python3 apps/web/scripts/extract-legal.py
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESIGNS = ROOT / "docs/designs/web"
OUT = ROOT / "apps/web/content/legal"
PAGES = {
    "terms": "terms_of_service",
    "privacy": "privacy_policy",
    "community-standards": "community_standards",
    "tenancy-guidelines": "tenancy_guidelines",
}
KEEP = {"h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "b", "em", "i", "hr", "table", "thead", "tbody", "tr", "th", "td", "blockquote"}
DROP = {"script", "style", "svg", "nav", "footer", "aside", "button", "form", "input", "select", "noscript", "img", "picture"}
VOID = {"hr", "br", "img", "input", "meta", "link", "path", "circle", "rect", "line", "polyline"}
RENAME = {"b": "strong", "i": "em"}
# Layout boxes: their content is unwrapped, but they separate lines (and spans separate words).
BLOCKISH = {"div", "section", "header", "article", "dl", "dt", "dd", "figure", "figcaption", "main"}
INLINE = {"strong", "em"}
ICON_CLASSES = ("material-symbols", "material-icons")
# Invented business details → placeholders, longest first (addresses contain the company name).
PLACEHOLDERS = [
    (r"Flatrimony Legal Cell, DLF CyberCity, Building 10, Tower B, Phase 2, Gurugram, Haryana 122002(, India)?",
     "[Registered address]"),
    (r"Compliance Division, Flatrimony Technologies Pvt\. Ltd\., DLF CyberCity, Building 10, Phase 2, "
     r"Gurugram, Haryana 122002(, India)?", "[Registered address]"),
    (r"Flatrimony Technologies (Pvt\. Ltd\.|Private Limited)", "[Company legal name]"),
    (r"\b([a-z]+)@flatrimony\.in\b", r"[\1 email]"),
]
# The designs' own draft notes (the page shows one banner for all four) and a compliance badge that
# cannot be claimed before the legal review.
INTRO_DROP = re.compile(
    r"^(Draft|मसौदा)(\s|—|$)|pending legal review|कानूनी समीक्षा|हिंदी अनुवाद केवल सुविधा|^DPDP\b.*(Compliant|अनुपालित)$"
)
# Decoration that survives as text: separators ("·", "|") and step badges ("01").
NOISE = re.compile(r"^[\s·|•–—-]*$|^\d{1,2}$|^[A-Za-z]$")


class Extract(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.started = False  # content starts at the page's h1
        self.title = ""
        self.in_title = False
        self.drop = 0
        self.root = {"t": "root", "c": []}
        self.stack = [self.root]
        self.open = []  # tags as opened, with whether each made a node

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if tag == "hr" and self.started and not self.drop:
                self.stack[-1]["c"].append({"t": "hr"})
            if tag == "br" and self.started and not self.drop:
                self.stack[-1]["c"].append(" ")
            return
        classes = dict(attrs).get("class") or ""
        if self.drop or tag in DROP or any(c in classes for c in ICON_CLASSES):
            self.drop += 1
            self.open.append((tag, "drop"))
            return
        if tag == "h1":
            self.started = True
            self.in_title = True
            self.open.append((tag, "title"))
            return
        if self.started and tag in BLOCKISH:
            self.stack[-1]["c"].append("\n")
        elif self.started and tag == "span":
            self.stack[-1]["c"].append(" ")
        if self.started and tag in KEEP:
            node = {"t": RENAME.get(tag, tag), "c": []}
            self.stack[-1]["c"].append(node)
            self.stack.append(node)
            self.open.append((tag, "node"))
        else:
            self.open.append((tag, "skip"))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        # Close up to the matching tag (the exports are well formed; this tolerates strays).
        for i in range(len(self.open) - 1, -1, -1):
            if self.open[i][0] == tag:
                for _, kind in reversed(self.open[i:]):
                    if kind == "drop":
                        self.drop -= 1
                    elif kind == "node":
                        self.stack.pop()
                    elif kind == "title":
                        self.in_title = False
                del self.open[i:]
                if self.started and not self.drop:
                    if tag in BLOCKISH:
                        self.stack[-1]["c"].append("\n")
                    elif tag == "span":
                        self.stack[-1]["c"].append(" ")
                return

    def handle_data(self, data):
        if self.drop:
            return
        if self.in_title:
            self.title += data
        elif self.started:
            self.stack[-1]["c"].append(data)


def squash(text, keep_lines):
    """Whitespace runs become one space, or one line break when they held one and lines count."""
    text = html.unescape(text)
    for pattern, placeholder in PLACEHOLDERS:
        text = re.sub(pattern, placeholder, text)
    if keep_lines:
        return re.sub(r"\s+", lambda m: "\n" if "\n" in m.group(0) else " ", text)
    return re.sub(r"\s+", " ", text)


def tidy(node, keep_lines=False):
    """Collapses whitespace, merges text, drops empty elements. Line breaks survive at block level."""
    if isinstance(node, str):
        return node
    out = []
    for child in node.get("c", []):
        child = tidy(child)
        if isinstance(child, str):
            child = squash(child, keep_lines)
            if out and isinstance(out[-1], str):
                out[-1] += child
            else:
                out.append(child)
        elif child["t"] == "hr" or child.get("c"):
            out.append(child)
    if out and isinstance(out[0], str):
        out[0] = out[0].lstrip()
    if out and isinstance(out[-1], str):
        out[-1] = out[-1].rstrip()
    out = [c for c in out if c != ""]
    if node["t"] == "hr":
        return {"t": "hr"}
    return {"t": node["t"], "c": out}


def text_of(node):
    return node if isinstance(node, str) else "".join(text_of(c) for c in node.get("c", []))


def paragraphs(items):
    """Loose text and bold/italic between blocks (from unwrapped layout boxes) become paragraphs,
    one per line."""
    blocks, line = [], []

    def flush():
        while line and isinstance(line[0], str) and not line[0].strip():
            line.pop(0)
        while line and isinstance(line[-1], str) and not line[-1].strip():
            line.pop()
        if line:
            if isinstance(line[0], str):
                line[0] = line[0].lstrip()
            if isinstance(line[-1], str):
                line[-1] = line[-1].rstrip()
            para = {"t": "p", "c": [re.sub(r" {2,}", " ", x) if isinstance(x, str) else x for x in line]}
            if not NOISE.match(text_of(para)):
                blocks.append(para)
        line.clear()

    for item in items:
        if isinstance(item, str):
            parts = item.split("\n")
            for k, part in enumerate(parts):
                if k:
                    flush()
                if part:
                    line.append(part)
        elif item["t"] in INLINE:
            line.append(item)
        else:
            flush()
            blocks.append(item)
    flush()
    return blocks


def extract(path):
    p = Extract()
    p.feed(path.read_text(encoding="utf-8"))
    blocks = paragraphs(tidy(p.root, keep_lines=True)["c"])
    intro, sections, current = [], [], None
    for b in blocks:
        if b["t"] == "h2":
            current = {"title": text_of(b).strip(), "blocks": []}
            sections.append(current)
        elif current is None:
            if not INTRO_DROP.search(text_of(b).strip()):
                intro.append(b)
        else:
            current["blocks"].append(b)
    for s in sections:  # rules between sections are the page's job
        while s["blocks"] and s["blocks"][-1]["t"] == "hr":
            s["blocks"].pop()
    return {"title": re.sub(r"\s+", " ", p.title).strip(), "intro": intro, "sections": sections}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for page, folder in PAGES.items():
        for locale in ("en", "hi"):
            src = DESIGNS / locale / folder / "index.html"
            data = extract(src)
            dest = OUT / f"{page}.{locale}.json"
            dest.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"{dest.relative_to(ROOT)}: {data['title']!r}, {len(data['intro'])} intro blocks, "
                  f"{len(data['sections'])} sections")


if __name__ == "__main__":
    sys.exit(main())
