"""Shared Jinja2-rendered-HTML → PDF bytes helper.

Extracted from invoice_service.render_invoice_pdf (which still owns loading
its own template *file*) so any caller with an already-rendered HTML string —
invoices, or an org's own uploaded document template for policy_documents —
gets the same WeasyPrint-first, xhtml2pdf-fallback behaviour instead of each
reimplementing it.
"""
from __future__ import annotations


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
        result = pisa.CreatePDF(html_str, dest=buf)
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
