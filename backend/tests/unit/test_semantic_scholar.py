"""Unit tests for semantic_scholar.py — pure logic only, no network calls."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from semantic_scholar import (
    extract_arxiv_id,
    paper_id_from_url,
    format_authors,
    format_paper,
    best_pdf_url,
    order_references_by_pdf,
)


# ---------------------------------------------------------------------------
# extract_arxiv_id
# ---------------------------------------------------------------------------

class TestExtractArxivId:

    def test_arxiv_abs_url(self):
        assert extract_arxiv_id("https://arxiv.org/abs/1706.03762") == "1706.03762"

    def test_arxiv_url_with_version(self):
        assert extract_arxiv_id("https://arxiv.org/pdf/1706.03762v3") == "1706.03762"

    def test_bare_id(self):
        assert extract_arxiv_id("1706.03762") == "1706.03762"

    def test_non_arxiv_url(self):
        assert extract_arxiv_id("https://example.com/paper") is None


# ---------------------------------------------------------------------------
# paper_id_from_url
# ---------------------------------------------------------------------------

class TestPaperIdFromUrl:

    def test_arxiv_url(self):
        assert paper_id_from_url("https://arxiv.org/abs/1706.03762") == "arXiv:1706.03762"

    def test_doi_url(self):
        assert paper_id_from_url("https://doi.org/10.1145/1234567.1234568") == "DOI:10.1145/1234567.1234568"

    def test_unknown_url(self):
        assert paper_id_from_url("https://example.com/paper") is None


# ---------------------------------------------------------------------------
# format_authors
# ---------------------------------------------------------------------------

class TestFormatAuthors:

    def test_one_author(self):
        paper = {"authors": [{"name": "Alice Smith"}]}
        assert format_authors(paper) == "Alice Smith"

    def test_three_authors(self):
        paper = {"authors": [{"name": "Alice"}, {"name": "Bob"}, {"name": "Carol"}]}
        assert format_authors(paper) == "Alice, Bob, Carol"

    def test_five_authors_et_al(self):
        paper = {"authors": [
            {"name": "Alice"}, {"name": "Bob"}, {"name": "Carol"},
            {"name": "Dave"}, {"name": "Eve"},
        ]}
        result = format_authors(paper)
        assert result == "Alice, Bob, Carol, et al."

    def test_empty_list(self):
        assert format_authors({"authors": []}) == ""
        assert format_authors({}) == ""


# ---------------------------------------------------------------------------
# format_paper
# ---------------------------------------------------------------------------

class TestFormatPaper:

    def test_full_paper(self):
        paper = {
            "paperId": "abc123",
            "title": "Attention Is All You Need",
            "authors": [{"name": "Vaswani"}, {"name": "Shazeer"}],
            "year": 2017,
            "venue": "NeurIPS",
            "citationCount": 50000,
            "externalIds": {"ArXiv": "1706.03762"},
            "openAccessPdf": {"url": "https://arxiv.org/pdf/1706.03762"},
        }
        result = format_paper(paper)
        assert result["s2_paper_id"] == "abc123"
        assert result["title"] == "Attention Is All You Need"
        assert result["year"] == 2017
        assert result["venue"] == "NeurIPS"
        assert result["citation_count"] == 50000
        assert result["arxiv_url"] == "https://arxiv.org/abs/1706.03762"
        assert result["pdf_url"] == "https://arxiv.org/pdf/1706.03762"
        assert result["relation"] is None

    def test_paper_missing_optional_fields(self):
        paper = {
            "paperId": "xyz789",
            "title": "Some Paper",
        }
        result = format_paper(paper, relation="reference")
        assert result["s2_paper_id"] == "xyz789"
        assert result["title"] == "Some Paper"
        assert result["year"] is None
        assert result["venue"] == ""
        assert result["citation_count"] is None
        assert result["arxiv_url"] is None
        assert result["pdf_url"] is None
        assert result["relation"] == "reference"


# ---------------------------------------------------------------------------
# best_pdf_url
# ---------------------------------------------------------------------------

class TestBestPdfUrl:

    def test_with_open_access_pdf(self):
        paper = {"openAccessPdf": {"url": "https://arxiv.org/pdf/1706.03762"}}
        assert best_pdf_url(paper) == "https://arxiv.org/pdf/1706.03762"

    def test_arxiv_fallback(self):
        paper = {
            "openAccessPdf": None,
            "externalIds": {"ArXiv": "1706.03762"},
        }
        assert best_pdf_url(paper) == "https://arxiv.org/pdf/1706.03762"

    def test_acm_blocked_falls_to_arxiv(self):
        paper = {
            "openAccessPdf": {"url": "https://dl.acm.org/doi/pdf/10.1145/xxx"},
            "externalIds": {"ArXiv": "2301.00001"},
        }
        assert best_pdf_url(paper) == "https://arxiv.org/pdf/2301.00001"

    def test_neither(self):
        paper = {"openAccessPdf": None, "externalIds": {}}
        assert best_pdf_url(paper) is None


# ---------------------------------------------------------------------------
# order_references_by_pdf
# ---------------------------------------------------------------------------

class TestOrderReferencesByPdf:

    def test_empty_text(self):
        refs = [{"title": "Paper A"}, {"title": "Paper B"}]
        assert order_references_by_pdf(refs, "") == refs

    def test_reorder_by_text_position(self):
        pdf_text = """
References

[1] First paper about transformers in NLP domains.
[2] Second paper on convolutional neural nets.
[3] Third paper on reinforcement learning.
"""
        refs = [
            {"title": "Third paper on reinforcement learning"},
            {"title": "First paper about transformers in NLP domains"},
            {"title": "Second paper on convolutional neural nets"},
        ]
        result = order_references_by_pdf(refs, pdf_text)
        assert result[0]["title"] == "First paper about transformers in NLP domains"
        assert result[1]["title"] == "Second paper on convolutional neural nets"
        assert result[2]["title"] == "Third paper on reinforcement learning"

    def test_missing_refs_appended_at_end(self):
        pdf_text = """
References

[1] Known paper title appears here.
"""
        refs = [
            {"title": "Unknown paper not in text"},
            {"title": "Known paper title appears here"},
        ]
        result = order_references_by_pdf(refs, pdf_text)
        assert result[0]["title"] == "Known paper title appears here"
        assert result[1]["title"] == "Unknown paper not in text"
