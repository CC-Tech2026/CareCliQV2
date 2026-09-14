"""Shared Jinja2-rendered-HTML → PDF bytes helper.

Extracted from invoice_service.render_invoice_pdf (which still owns loading
its own template *file*) so any caller with an already-rendered HTML string —
invoices, or an org's own uploaded document template for policy_documents —
gets the same WeasyPrint-first, xhtml2pdf-fallback behaviour instead of each
reimplementing it.
"""
from __future__ import annotations

import re

# CSS3 @page margin boxes (@top-left, @bottom-right, etc.) are how WeasyPrint
# renders running headers/footers with page-number counters. xhtml2pdf's CSS
# parser doesn't support them at all — it raises a bare TypeError while
# parsing the @page block instead of skipping the part it doesn't recognise —
# so any template using one would otherwise crash the entire xhtml2pdf
# fallback. Templates get their page number from <pdf:pagenumber/> in that
# fallback instead, so it's safe to strip these blocks before parsing.
_PAGE_MARGIN_BOX_RE = re.compile(
    r"@(?:top|bottom|left|right)-(?:left|center|right|top|middle|bottom)"
    r"(?:-corner)?\s*\{[^{}]*\}",
    re.IGNORECASE,
)

# Scopes the strip to <style> blocks only. Some callers (policy_documents)
# render arbitrary org-authored HTML content through this same function, and
# that content could coincidentally contain visible text shaped like a margin
# box rule (e.g. quoted in a <pre> block) — stripping the whole HTML string
# would silently delete that text instead of only sanitising real CSS.
_STYLE_BLOCK_RE = re.compile(r"(<style\b[^>]*>)(.*?)(</style>)", re.IGNORECASE | re.DOTALL)


def _strip_page_margin_boxes(html_str: str) -> str:
    return _STYLE_BLOCK_RE.sub(
        lambda m: m.group(1) + _PAGE_MARGIN_BOX_RE.sub("", m.group(2)) + m.group(3),
        html_str,
    )


class HtmlPdfRenderError(Exception):
    """Raised when neither WeasyPrint nor xhtml2pdf can render the HTML."""


def render_html_to_pdf(html_str: str, base_url: str | None = None) -> bytes:
    """Render an HTML string to PDF bytes.

    Tries WeasyPrint first (preferred, production-grade, Linux/GTK).
    Falls back to xhtml2pdf (pure-Python, works on Windows without GTK).
    """
    try:
        from weasyprint import HTML
        return HTML(string=html_str, base_url=base_url).write_pdf()
    except Exception:
        pass

    try:
        import io
        from xhtml2pdf import pisa
        buf = io.BytesIO()
        result = pisa.CreatePDF(_strip_page_margin_boxes(html_str), dest=buf)
        if not result.err:
            return buf.getvalue()
    except ImportError:
        pass
    except Exception:
        # xhtml2pdf's own CSS parser can raise on constructs it doesn't
        # support (e.g. a TypeError on @page { @bottom-right {...} }) rather
        # than failing gracefully — fall through to the shared error below
        # instead of letting that escape as an unhandled 500.
        pass

    raise HtmlPdfRenderError(
        "PDF rendering failed: install weasyprint (Linux) or xhtml2pdf (Windows)."
    )
