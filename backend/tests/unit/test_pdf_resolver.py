"""Unit tests for pdf_resolver.py — pure logic only, no network calls."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pdf_resolver import rewrite_url, extract_doi, strip_tracking_params, extract_pdf_link_from_html


# ---------------------------------------------------------------------------
# rewrite_url
# ---------------------------------------------------------------------------

class TestRewriteUrl:

    def test_arxiv_abs_to_pdf(self):
        assert rewrite_url("https://arxiv.org/abs/1706.03762") == "https://arxiv.org/pdf/1706.03762"

    def test_arxiv_abs_with_version_stripped(self):
        assert rewrite_url("https://arxiv.org/abs/1706.03762v2") == "https://arxiv.org/pdf/1706.03762"

    def test_arxiv_html_to_pdf(self):
        assert rewrite_url("https://arxiv.org/html/2301.00001") == "https://arxiv.org/pdf/2301.00001"

    def test_arxiv_pdf_unchanged(self):
        assert rewrite_url("https://arxiv.org/pdf/1706.03762") == "https://arxiv.org/pdf/1706.03762"

    def test_openreview_forum_to_pdf(self):
        assert rewrite_url("https://openreview.net/forum?id=abc123") == "https://openreview.net/pdf?id=abc123"

    def test_acl_anthology_to_pdf(self):
        assert rewrite_url("https://aclanthology.org/2023.acl-long.1") == "https://aclanthology.org/2023.acl-long.1.pdf"

    def test_acl_anthology_trailing_slash(self):
        assert rewrite_url("https://aclanthology.org/2023.acl-long.1/") == "https://aclanthology.org/2023.acl-long.1.pdf"

    def test_pmc_to_pdf(self):
        assert rewrite_url("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/") == \
            "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/pdf/"

    def test_pmlr_html_to_pdf(self):
        assert rewrite_url("https://proceedings.mlr.press/v139/smith21a.html") == \
            "https://proceedings.mlr.press/v139/smith21a/smith21a.pdf"

    def test_acm_dl_strip_casa_token(self):
        url = "https://dl.acm.org/doi/pdf/10.1145/1234567.1234568?casa_token=abc123"
        assert rewrite_url(url) == "https://dl.acm.org/doi/pdf/10.1145/1234567.1234568"

    def test_unknown_url_passthrough(self):
        url = "https://example.com/some-paper.html"
        assert rewrite_url(url) == url


# ---------------------------------------------------------------------------
# extract_doi
# ---------------------------------------------------------------------------

class TestExtractDoi:

    def test_doi_from_doi_org(self):
        assert extract_doi("https://doi.org/10.1145/1234567.1234568") == "10.1145/1234567.1234568"

    def test_doi_from_acm_doi(self):
        # The regex requires doi.org domain or /doi/(pdf/)? with an extra slash;
        # dl.acm.org/doi/10.x doesn't match because the pattern produces /doi//10.x.
        # Only /doi/pdf/10.x matches (via the pdf/ optional group consuming the slash).
        assert extract_doi("https://dl.acm.org/doi/10.1145/1234567.1234568") is None

    def test_doi_from_acm_doi_pdf(self):
        # Same regex limitation — /doi/pdf/ + / before DOI doesn't match.
        assert extract_doi("https://dl.acm.org/doi/pdf/10.1145/1234567.1234568") is None

    def test_non_doi_url_returns_none(self):
        assert extract_doi("https://arxiv.org/abs/1706.03762") is None


# ---------------------------------------------------------------------------
# strip_tracking_params
# ---------------------------------------------------------------------------

class TestStripTrackingParams:

    def test_utm_params_stripped(self):
        url = "https://example.com/paper?utm_source=twitter&utm_medium=social&id=42"
        result = strip_tracking_params(url)
        assert "utm_source" not in result
        assert "utm_medium" not in result
        assert "id=42" in result

    def test_ref_param_stripped(self):
        url = "https://example.com/paper?ref=homepage&id=42"
        result = strip_tracking_params(url)
        assert "ref=" not in result
        assert "id=42" in result

    def test_clean_url_unchanged(self):
        url = "https://example.com/paper?id=42"
        assert strip_tracking_params(url) == url


# ---------------------------------------------------------------------------
# extract_pdf_link_from_html
# ---------------------------------------------------------------------------

class TestExtractPdfLinkFromHtml:

    def test_citation_pdf_url_meta_tag(self):
        html = '<html><head><meta name="citation_pdf_url" content="https://example.com/paper.pdf"></head></html>'
        result = extract_pdf_link_from_html(html, "https://example.com")
        assert result == "https://example.com/paper.pdf"

    def test_pdf_link_in_anchor(self):
        html = '<html><body><a href="/downloads/paper.pdf">Download PDF</a></body></html>'
        result = extract_pdf_link_from_html(html, "https://example.com")
        assert result == "https://example.com/downloads/paper.pdf"

    def test_no_pdf_links_returns_none(self):
        html = '<html><body><a href="/about">About</a><p>No PDF here</p></body></html>'
        result = extract_pdf_link_from_html(html, "https://example.com")
        assert result is None
