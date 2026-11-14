# Retrieval baseline

Date: 2026-11-14. Code: `master` at `a8cfd35`, before any Track B retrieval change.

Status: RET-01 to RET-07 of the [focus plan](reader-beta-and-retrieval-plan.md#track-b-retrieval-quality). The baseline section records how well the pre-Track B lexical search found the pages that answer a question; [Changes evaluated](#changes-evaluated-ret-04-to-ret-07) records every candidate change, kept or rejected. RET-09's manual answer grades will be added here later.

## What is measured

`npm run eval:retrieval` indexes the ten corpus texts into a temporary library through the real `RetrievalService.index`, then runs each labelled question through the product's retrieval code, building the query the way the product does:

| Call path | Query sent to `search` | Scope | Product limit |
| --- | --- | --- | --- |
| Reader chat (`ChatPanel` → `/api/chat` → `ChatService.ask`) | the question, then a blank line and each selection line prefixed with `> ` | the open paper | 16 |
| Project chat (`ProjectChat` → `/api/chat`) | the question | the selected papers | 16 |
| Visual explanation (`/visual` in the reader) | `question + ' ' + selection` | the open paper | 6 |
| Project search and `pdfpal search` | the typed text | the whole project | 20 |

Since RET-06 and RET-07, the chat paths (reader chat, project chat, visual explanations) are scored through `RetrievalService.context`, which is what the assistant receives; project search through `RetrievalService.search`. The baseline variant reproduces the pre-Track B code.

Every question is scored at limits 6 and 16, in two scopes:

- **Product scope**: the sources the product would search for that question (one paper in the reader, the selected papers in a project).
- **Whole library**: the same query over all ten works. Mistral 7B, Mixtral and the transformer introduction have only 22 to 28 chunks each, so a 16-chunk reader search returns most of the paper and the product scope is close to its ceiling. The whole-library scope (682 chunks) is the more sensitive test of ranking.

A hit is a returned passage from the gold source whose `page_number` is one of the gold pages. **recall@k** is the share of questions with at least one hit in the top k (often called success@k). **MRR** is the mean reciprocal rank of the first hit within 16, counting a miss as 0. **ctx@k** is the mean number of passage characters returned at limit k. Portuguese questions are reported separately and are not part of "overall".

## Corpus

All works are licensed CC BY 4.0. **The papers are not redistributed:** the repository holds only the manifest, the questions (with short verbatim selections and evidence snippets) and the tooling. Each user downloads the PDFs from their publishers once with `npm run eval:retrieval:fetch`, which extracts their text into a local, git-ignored cache.

The manifest at `test/fixtures/retrieval/manifest.json` records title, authors, source and PDF URLs, licence and licence URL, SHA-256 of the PDF and of the extracted text the labels were made on, page count, and the attribution line CC BY requires. The text is the output of pdfpal's own `extractPdf`, so it keeps the `[Page N]` markers and real extraction noise (running headers, table cells run together, ligature and hyphenation artefacts, math in Unicode italics).

| Id | Work | Kind | PDF pages | Questions |
| --- | --- | --- | --- | --- |
| `llama` | Touvron et al., [LLaMA: Open and Efficient Foundation Language Models](https://arxiv.org/abs/2302.13971v1) | paper | 27 | 10 |
| `mistral-7b` | Jiang et al., [Mistral 7B](https://arxiv.org/abs/2310.06825v1) | paper | 9 | 6 |
| `mixtral` | Jiang et al., [Mixtral of Experts](https://arxiv.org/abs/2401.04088v1) | paper | 13 | 8 |
| `qlora` | Dettmers et al., [QLoRA: Efficient Finetuning of Quantized LLMs](https://arxiv.org/abs/2305.14314v1) | paper | 26 | 8 |
| `mamba` | Gu and Dao, [Mamba: Linear-Time Sequence Modeling with Selective State Spaces](https://arxiv.org/abs/2312.00752v2) | paper | 36 | 7 |
| `contriever` | Izacard et al., [Unsupervised Dense Information Retrieval with Contrastive Learning](https://arxiv.org/abs/2112.09118v4) | paper | 21 | 6 |
| `colbertv2` | Santhanam et al., [ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction](https://arxiv.org/abs/2112.01488v3) | paper | 20 | 6 |
| `e5` | Wang et al., [Text Embeddings by Weakly-Supervised Contrastive Pre-training](https://arxiv.org/abs/2212.03533v2) | paper | 17 | 7 |
| `intro-transformers` | Turner, [An Introduction to Transformers](https://arxiv.org/abs/2304.10557v6) | paper | 10 | 6 |
| `fm4nlp-ch2` | Paaß and Giesselbach, [Pre-trained Language Models](https://link.springer.com/chapter/10.1007/978-3-031-23190-2_2), chapter 2 of *Foundation Models for Natural Language Processing* (Springer, 2023) | book chapter | 60 | 8 |

The papers form three groups of close neighbours, so "which of these papers says X" questions are meaningful: decoder language models and finetuning (LLaMA, Mistral 7B, Mixtral, QLoRA), dense retrieval (Contriever, ColBERTv2, E5), and transformer explanations (Introduction to Transformers, the book chapter, Mamba).

How the licences were checked:

- arXiv: the licence link on the abstract page of the exact pinned version (for example `arxiv.org/abs/2302.13971v1`) points to `creativecommons.org/licenses/by/4.0/`. The pinned version is the one downloaded.
- Springer chapter: the chapter page and the last page of the chapter PDF both state "licensed under the terms of the Creative Commons Attribution 4.0 International License".
- Every extracted text was searched for copyright and licence notices that contradict the listed licence.

Excluded during selection: works under arXiv's non-exclusive distribution licence (among them *Attention Is All You Need*, BERT, RoBERTa, DistilBERT, Llama 2, RAG, DPR, ColBERT, FlashAttention, LoRA, Chinchilla and the 2020 scaling-laws paper); CC BY-SA, CC BY-NC-SA and CC BY-NC-ND works (BEIR, Pythia, Jamba, SPLADE, RoFormer); two CC BY arXiv works whose PDFs print "All rights reserved" (the Gemma report and *Formal Algorithms for Transformers*); and *Foundations of Large Language Models*, which is CC BY on arXiv but CC BY-NC inside the PDF.

For the maintainer to note: the ColBERTv2 and E5 papers reproduce a few short example queries and answer snippets from StackExchange, Reddit and similar sources in their dataset tables (ColBERTv2 pages 6 and 7, E5 page 15). They are part of the CC BY works as published, but they originate from sites with their own licences. Drop those works if that is not acceptable.

### Setting up the corpus

```bash
npm run eval:retrieval:fetch                     # once; downloads about 16 MB of PDFs
npm run eval:retrieval:fetch -- --pdf-dir DIR    # reuse or keep the PDFs in DIR (outside the repository)
```

The setup command (`scripts/fetch-retrieval-fixtures.ts`) downloads each pinned PDF sequentially, with pauses and a generic user agent, into a temporary directory outside the repository; checks its SHA-256 against the manifest (a mismatch is an error and nothing is written for that work); runs `extractPdf`; and writes `<id>.txt` to `.cache/retrieval/`, which is git-ignored. Maintainers can pass `--update` to record new hashes, page counts and attribution lines. Neither `npm test` nor `npm run eval:retrieval` ever downloads anything.

If an extracted text differs from the manifest's `text_sha256` (for example after a `pdfjs-dist` upgrade changes extraction), the setup command and the evaluation print a warning rather than fail. The labels' correctness does not depend on the hash: before scoring, the evaluation checks that every evidence snippet and selection still occurs on its labelled page, and stops with an error naming each one that does not. The warning says the numbers may differ from those recorded here; comparisons between variants within one run remain valid because every variant indexes the same text.

## Questions

`test/fixtures/retrieval/questions.json` holds 72 questions: 65 in English and 7 in Portuguese.

| Category | What it tests | Scored | Holdout |
| --- | --- | --- | --- |
| Exact terms | The question uses the paper's wording | 9 | 1 |
| Word forms | A different inflection or spelling (normalized / normalises, masking / masked, cropped / cropping, indexed / indexing) | 9 | 1 |
| Paraphrase | Few content words shared with the answering passage | 9 | 2 |
| Selection attached | A verbatim selection plus a short question such as "Why is that?"; the answer may be on another page | 9 | 2 |
| Symbols and identifiers | `n_kv_heads`, `β1`, `τ`, `d_k`, `BERT-base`, `NF4`, `gpt-3.5-turbo-1106`, `MRR@10`, formulas | 10 | 2 |
| Across a project | Scoped to three or four similar papers, or the whole project; the answer is in one of them | 9 | 2 |
| Portuguese | Questions in Portuguese about English papers | 7 | 0 |

How the labels were made:

- Each page of the extracted text was read before writing its questions. Gold pages are every page whose text answers the question, found by reading the page and by searching the text for the answer's own wording. The product search was not run until every label was final, and no label was changed after seeing its output.
- Every gold page carries at least one short `evidence` snippet copied verbatim from that page; selection questions record the selected text and its page. Every evaluation run checks that each snippet occurs on its labelled page before scoring, so a wrong page number fails loudly. The unit tests check the labels' structure (sources exist, pages are within the paper, every gold page has evidence) without the text.
- Each question records the call path and scope it simulates. Selection questions use the reader's composition; one (`select-11`) uses the visual-explanation composition.
- Ten questions, spread across all six categories, are marked `holdout`. The default run skips them; `--include-holdout` scores them. They are for RET-09's before-and-after check only and must not be looked at while tuning. Their scores are not in this document.

## Running it

```bash
npm run eval:retrieval:fetch                     # once: set up the corpus text cache
npm run eval:retrieval                          # the shipped retrieval (variant `current`), both scopes
npm run eval:retrieval -- --variant baseline     # the pre-Track B retrieval measured below
npm run eval:retrieval -- --json > report.json   # full report with per-question ranks and returned pages
npm run eval:retrieval -- --compare report.json  # deltas against a saved report
npm run eval:retrieval -- --include-holdout      # RET-09 only
npx tsx scripts/retrieval-eval/compare-all.ts NAME... [--against NAME]   # several variants side by side, with per-category question deltas
```

With the cache missing or incomplete, the evaluation stops with a message naming the setup command; it never downloads anything. The run is offline, deterministic (identical output on repeated runs) and takes a few seconds. It uses the test configuration helpers to create a temporary library, refuses to run if `PDFPAL_DB` would point elsewhere, and removes the library afterwards. It is not part of `npm test`; `test/unit/retrieval-eval.test.ts` checks the metric functions, the query composition, the structure of the manifest and questions, and a run of the harness on a tiny synthetic corpus written in the test, so it behaves the same with or without the cache.

A candidate change is evaluated by adding a variant to `scripts/retrieval-eval/variants.ts`. A variant can rebuild the FTS table before indexing (`prepare`), index differently, and assemble its own results from the composed query, which keeps the question, the selection and the selection's page separate. `scripts/retrieval-eval/lab.ts` holds the prototype pipeline used for the RET-04 to RET-07 candidates; the `current` variant calls the shipped code.

## Baseline results

Implementation before Track B (variant `baseline`): default FTS5 tokenizer, the first 16 unique words of two or more characters joined with OR, BM25 ranking, 1,500-character chunks with 150 characters of overlap. 682 chunks in total. Holdout questions excluded.

Product scope:

| Set | n | recall@6 | recall@16 | MRR | ctx@6 | ctx@16 |
| --- | --- | --- | --- | --- | --- | --- |
| Exact terms | 9 | 1.000 | 1.000 | 1.000 | 8,398 | 22,066 |
| Word forms | 9 | 1.000 | 1.000 | 0.707 | 7,877 | 21,722 |
| Paraphrase | 9 | 0.778 | 1.000 | 0.726 | 8,199 | 21,151 |
| Selection attached | 9 | 1.000 | 1.000 | 0.754 | 8,217 | 22,050 |
| Symbols and identifiers | 10 | 0.900 | 0.900 | 0.770 | 7,746 | 20,218 |
| Across a project | 9 | 1.000 | 1.000 | 0.944 | 8,072 | 21,569 |
| **Overall** | **55** | **0.946** | **0.982** | **0.816** | **8,079** | **21,440** |
| Portuguese | 7 | 0.857 | 0.857 | 0.548 | 7,148 | 18,088 |

Whole library:

| Set | n | recall@6 | recall@16 | MRR | ctx@6 | ctx@16 |
| --- | --- | --- | --- | --- | --- | --- |
| Exact terms | 9 | 1.000 | 1.000 | 1.000 | 8,275 | 22,196 |
| Word forms | 9 | 0.778 | 0.889 | 0.482 | 8,299 | 22,537 |
| Paraphrase | 9 | 0.556 | 0.667 | 0.400 | 8,353 | 22,129 |
| Selection attached | 9 | 0.889 | 0.889 | 0.732 | 8,155 | 22,658 |
| Symbols and identifiers | 10 | 0.800 | 0.900 | 0.710 | 8,044 | 21,382 |
| Across a project | 9 | 1.000 | 1.000 | 0.944 | 8,168 | 21,677 |
| **Overall** | **55** | **0.836** | **0.891** | **0.711** | **8,213** | **22,083** |
| Portuguese | 7 | 0.571 | 0.857 | 0.491 | 6,875 | 18,298 |

Product scope misses at 6: `para-02`, `para-09`, `symbol-09` and `pt-04`; the last two are also missed at 16. Whole-library misses at 16: `forms-01`, `para-02`, `para-07`, `para-09`, `select-07`, `symbol-09` and `pt-04`. The JSON report lists every question's rank and returned pages.

What the misses show:

- **Single-character symbols vanish from the query.** "Why divide by sqrt(d_k) in attention?" (`symbol-09`) keeps only `why`, `divide`, `by`, `sqrt`, `in` and `attention`: the query tokenizer drops the one-letter parts of `d_k`, and the chapter writes the factor as `1/√dk`. In a 60-page chapter about attention, page 4 does not reach the top 16. `τ` in `symbol-08` is dropped the same way; that question still ranks the right page first through its other words.
- **Portuguese can return nothing.** `pt-04` ("O que é a quantização dupla…") shares no term with the English paper, so search returns no passages. Chat would then fall back to the first 15,000 characters of the paper, which is not retrieval. The Portuguese questions that hit did so through names and English loanwords they share with the paper (LLaMA, CommonCrawl, BERT, MASK, cache, buffer, query, passage, MoCo, Mamba).
- **No stemming.** `forms-01` asks which inputs get "normalized"; LLaMA says "normalize" and "normalizing". It ranks 5th in the reader and is missed across the library. American "normalized" against the introduction's British "normalises" (`forms-04`) would not be fixed by Porter stemming either.
- **The selection outweighs the question.** In `select-07` the selection's own page ranks first; the first page that gives the batch size ranks 5th in the reader and is missed across the library. Paraphrases (`para-02` "environmental cost", `para-07` "one network for both questions and passages") depend on a single generic shared word.

What the numbers do and do not show:

- The set is small: 55 scored questions, 9 or 10 per category. One question moves a category score by 0.10 to 0.11 and the overall score by about 0.02. Treat differences of one or two questions as noise.
- They measure passage retrieval, not answer quality. A hit means the assistant received text from a page that answers the question; it says nothing about whether the answer used it. RET-09 covers answers.
- The product-scope numbers are high mainly because a reader search over a short paper returns most of it. They are the right numbers for "does the reader see the answer", but they cannot show much improvement. Use the whole-library numbers and MRR to compare changes.
- The corpus is English machine-learning text extracted by the current pdfjs version. It does not represent scanned PDFs, other fields, or non-English papers.
- Kindle research and the zero-result fallback are not modelled.

## Changes evaluated (RET-04 to RET-07)

Date: 2026-11-14. Same corpus, the same 55 scored questions and 7 Portuguese questions, frozen labels; holdout questions were never run.

Keep rule: keep a change if whole-library MRR or recall@6 improves, product-scope numbers do not get worse overall, and no category loses more than one question at recall@6 or recall@16 in either scope. Portuguese is judged separately. Each candidate was first evaluated alone against the baseline, then on top of the changes already kept (`kept1`: the four that passed alone; `kept2`: `kept1` plus one-character terms), then shipped and re-measured through the product code (variant `current`). Every row below is reproducible with `npx tsx scripts/retrieval-eval/compare-all.ts NAME... [--against NAME]`.

### Decisions

| Plan item | Candidate | Decision | Why |
| --- | --- | --- | --- |
| RET-04 | Porter stemming (`porter unicode61 remove_diacritics 2`) | **Rejected** | Alone, whole-library MRR fell 0.711 → 0.686 and recall@6 0.836 → 0.818, and paraphrase lost two questions at recall@6. It fixed `forms-01` and raised whole-library recall@16 (0.891 → 0.927), but on top of the kept changes it still lost two paraphrase questions at recall@6 (three at recall@16 when combined with stopwords). Stemming makes common words match more chunks, which pushes paraphrase answers down. No schema migration was shipped. |
| RET-04 control | `unicode61 remove_diacritics 2` without stemming | No effect | Identical numbers to the baseline. |
| RET-05 | Rarest 16 matching terms instead of the first 16 | **Kept** | Whole-library recall@6 0.836 → 0.855 (fixes `select-07`, whose long selection pushed the useful words out), MRR +0.005; product MRR +0.004; no category lost anything. Only queries with more than 16 distinct words change. |
| RET-05 | Keep one-character terms (`τ`, `x`, single letters) | **Kept, see note** | Alone: product MRR +0.010 and Portuguese recall@16 up, but whole-library MRR −0.005 with recall@6 unchanged, so it did not pass alone. On top of `kept1`: whole-library MRR 0.717 → 0.724, product MRR 0.819 → 0.828, symbols whole-library MRR +0.05, no English question lost; Portuguese lost one question at whole-library recall@6 and gained one at product recall@16. It is the fix for single-character symbols the index already keeps. The owner may prefer to reject it because it failed alone. |
| RET-05 | Drop English stopwords (with or without Portuguese) | **Rejected** | Whole-library MRR improved slightly (+0.003 to +0.005), but product MRR fell (0.819 → 0.803 on `kept1`; 0.828 → 0.792 on `kept2`, where whole-library MRR also fell). Paraphrase answers often share only function words with the question ("it explicitly does not compress"), so removing them loses rank. |
| RET-05 | Question words take the term budget before selection words | **Rejected** | No measurable effect: the reader already puts the question first, and the rarest-terms rule covers long selections. |
| RET-05 | Selection words weighted 0.5 against question words | **Rejected** | Alone it lost one selection question at recall@6 in both scopes. On top of the kept changes it moved one rank (+0.001 MRR overall), within noise, and needs three queries per search. |
| RET-06 | Selection page and neighbours ahead of search results | **Kept** | Whole-library recall@6 +1 (`select-07`), MRR +0.006; product MRR +0.002. Costs about 10,700 characters per selection question (see below). Applies only when the reader sends the page. |
| RET-07 | Chunk id as score tie-breaker | **Kept** | No measurable effect; kept as the determinism fix found during the baseline. |
| RET-07 | Merge overlapping consecutive chunks of a page | **Kept** | Saves about 600 characters per question at limit 16 (product ctx@16 21,440 → 20,832) at equal recall; MRR +0.002 because merged passages move later results up. |
| RET-07 | At most half the chunks from one source in multi-source chat | **Rejected** | No change in any English category alone or combined; one Portuguese question gained at whole-library recall@6. This corpus cannot show crowding, so there is no evidence for it. |

### Final configuration against the baseline

Per category, holdout excluded. Δ is against the baseline tables above.

| Set | Product r@6 | r@16 | MRR (Δ) | ctx@6 | ctx@16 | Library r@6 | r@16 | MRR (Δ) | ctx@6 | ctx@16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Exact terms | 1.000 | 1.000 | 1.000 (0) | 8,115 | 21,233 | 1.000 | 1.000 | 1.000 (0) | 8,108 | 21,646 |
| Word forms | 1.000 | 1.000 | 0.707 (0) | 7,872 | 20,940 | 0.778 | 0.889 | 0.427 (−0.055) | 8,248 | 22,339 |
| Paraphrase | 0.778 | 1.000 | 0.738 (+0.012) | 8,159 | 20,506 | 0.556 | 0.667 | 0.386 (−0.014) | 8,261 | 21,852 |
| Selection attached | 1.000 | 1.000 | 0.763 (+0.009) | 18,702 | 30,743 | 1.000 | 1.000 | 0.763 (+0.031) | 18,798 | 32,617 |
| Symbols and identifiers | 0.900 | 0.900 | 0.775 (+0.005) | 7,649 | 19,349 | 0.800 | 0.900 | 0.761 (+0.051) | 7,968 | 20,692 |
| Across a project | 1.000 | 1.000 | 1.000 (+0.056) | 8,097 | 21,221 | 1.000 | 1.000 | 1.000 (+0.056) | 8,108 | 21,460 |
| **Overall** | **0.946** | **0.982** | **0.830 (+0.014)** | **9,727** | **22,278** | **0.855** | **0.909** | **0.724 (+0.013)** | **9,880** | **23,384** |
| Portuguese | 0.857 | 1.000 | 0.619 (+0.071) | 8,232 | 20,427 | 0.429 | 0.857 | 0.481 (−0.010) | 7,907 | 21,740 |

No category lost a question at recall@6 or recall@16 in either scope. Word forms lost 0.055 whole-library MRR (one question ranked lower). The context increase is almost entirely the guaranteed selection pages; other categories send slightly less text than before because of merging.

Misses fixed: `select-07` (whole library) and `pt-04` (product scope at 16; the hit comes from one-letter Portuguese words such as "a" and "e" matching English text, which is luck rather than retrieval). Misses that remain: `symbol-09` everywhere (the text writes `√dk`, so `d_k` still does not match; only the rejected stopword combination found it); `para-02` and `para-09` at 6 in the product scope; across the whole library `forms-01`, `para-02`, `para-07` and `para-09` at 16, and Portuguese `pt-04` to `pt-07` at 6. Paraphrase remains the weakest category (whole-library recall@16 0.667, MRR 0.386): this is the RET-08 decision point, for the owner.

### Where each kept change lives

- **Rarest terms, one-character terms, tie-breaker**: in `RetrievalService.search` (through `queryTerms` and `searchChunks`), so all five call sites get them: reader and project chat, visual explanations, Kindle research, the project search route and `pdfpal search`. This is deliberate: they are how text becomes an FTS query. For typical search-box queries (16 words or fewer) the rarest-terms rule changes nothing; one-character terms now match (searching `τ` used to return nothing) and can add low-ranked matches to queries containing single letters; equal scores now have a fixed order.
- **Selection pages and merging**: only in `RetrievalService.context`, which `ChatService.ask` and `VisualExplanationService.startWeb` use to assemble what the assistant sees. Search results shown to users and returned by the CLI keep their chunk granularity and are not reordered. Kindle research still calls `search`, since no reader page exists there.

### Page-aware context (RET-06) and its budget

The reader now records the PDF page a selection starts on (`PdfViewer` reads it from the page element; clicking a highlight uses the annotation's page) and sends it as the optional `selection_page` field of `/api/chat` and of the visual-explanation request. Requests without it behave exactly as before; the CLI, the extension and Kindle paths do not send it. The server uses it only when one source is in scope and a selection is attached (chat recognises the reader's `> ` quote lines; visual explanations need `source_id` and `selection`). The visual request schema rejects a page that is not a positive integer; `/api/chat` ignores one.

The guaranteed passages are the selection's page, then the previous and next pages, each trimmed to 6,000 characters (around the selection on its own page, the end of the previous page, the start of the next). Search results from those pages are dropped and replaced by further results, so up to 16 (chat) or 6 (visual) search passages still follow. On this corpus the three pages average 10,653 characters (6,824 to 13,671) per selection question; no page reached the 6,000-character trim (the longest is 5,390). Chat assembles context up to 80,000 characters, adding passages in order, so the pages always fit: a reader chat with a selection now sends about 31,000 characters instead of about 22,000. A source without page markers counts as a single page and is limited to 6,000 characters. Visual explanations cut each passage at 12,000 characters, which the trimmed pages never reach. When nothing matches the question (for example a question in another language), the pages are still sent, so selection questions from the reader no longer reach the 15,000-character fallback.

### RET-04 migration and the FTS table

Stemming was rejected, so no schema change shipped and `CURRENT_SCHEMA` stays 15. In case it is revisited, the places that create or depend on the FTS table definition: only `src/core/database.ts` creates `source_chunks_fts` and its three triggers (and rebuilds the index after the legacy sessions migration). Everything else writes `source_chunks` rows and relies on the triggers: `RetrievalService.index` (imports, re-extraction, and `src/sync/worker.ts` after downloading a synced PDF) and trash restore in `src/core/trash.ts`. Backups copy the whole database file, and recovered libraries are opened through `openDatabase`, so a migration would also run on restored backups. A future tokenizer change therefore needs only a migration step in `database.ts` that drops and recreates the table and triggers and then runs `INSERT INTO source_chunks_fts(source_chunks_fts) VALUES('rebuild')`.

### All variants

Overall columns exclude Portuguese. `kept1+singles` is `kept2`.

| Variant | Prod r@6 | Prod r@16 | Prod MRR | Prod ctx@6 | Prod ctx@16 | Lib r@6 | Lib r@16 | Lib MRR | Lib ctx@6 | Lib ctx@16 | PT prod r@16 / MRR | PT lib r@16 / MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `baseline` | 0.946 | 0.982 | 0.816 | 8,079 | 21,440 | 0.836 | 0.891 | 0.711 | 8,213 | 22,083 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret04-porter` | 0.946 | 0.982 | 0.809 | 8,275 | 21,709 | 0.818 | 0.927 | 0.686 | 8,356 | 21,927 | 0.857 / 0.524 | 0.857 / 0.363 |
| `ret04-diacritics` | 0.946 | 0.982 | 0.816 | 8,079 | 21,440 | 0.836 | 0.891 | 0.711 | 8,213 | 22,083 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret05-stopwords` | 0.946 | 0.982 | 0.803 | 8,009 | 19,423 | 0.855 | 0.909 | 0.716 | 8,145 | 21,575 | 0.857 / 0.488 | 0.857 / 0.434 |
| `ret05-stopwords-pt` | 0.946 | 0.982 | 0.803 | 8,009 | 19,423 | 0.855 | 0.909 | 0.716 | 8,145 | 21,575 | 0.857 / 0.559 | 0.857 / 0.437 |
| `ret05-rarest` | 0.946 | 0.982 | 0.820 | 8,088 | 21,423 | 0.855 | 0.909 | 0.716 | 8,266 | 22,066 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret05-singles` | 0.946 | 0.982 | 0.826 | 8,155 | 21,400 | 0.836 | 0.891 | 0.706 | 8,221 | 22,046 | 1.000 / 0.587 | 0.857 / 0.472 |
| `ret05-question-first` | 0.946 | 0.982 | 0.816 | 8,079 | 21,440 | 0.836 | 0.891 | 0.711 | 8,213 | 22,083 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret05-selection-half` | 0.927 | 0.982 | 0.808 | 8,081 | 21,410 | 0.818 | 0.891 | 0.691 | 8,229 | 21,984 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret06-page-context` | 0.946 | 0.982 | 0.818 | 9,802 | 23,077 | 0.855 | 0.909 | 0.717 | 9,947 | 23,787 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret07-tiebreak` | 0.946 | 0.982 | 0.816 | 8,079 | 21,440 | 0.836 | 0.891 | 0.711 | 8,213 | 22,083 | 0.857 / 0.548 | 0.857 / 0.491 |
| `ret07-merge` | 0.946 | 0.982 | 0.818 | 7,921 | 20,832 | 0.836 | 0.891 | 0.712 | 8,117 | 21,756 | 0.857 / 0.559 | 0.857 / 0.505 |
| `ret07-cap` | 0.946 | 0.982 | 0.816 | 8,089 | 21,457 | 0.818 | 0.891 | 0.711 | 8,308 | 22,084 | 0.857 / 0.548 | 0.857 / 0.491 |
| `kept1` | 0.946 | 0.982 | 0.819 | 9,676 | 22,396 | 0.855 | 0.909 | 0.717 | 9,878 | 23,470 | 0.857 / 0.559 | 0.857 / 0.505 |
| `kept1+porter` | 0.946 | 0.982 | 0.817 | 9,886 | 22,693 | 0.836 | 0.946 | 0.695 | 10,047 | 23,296 | 0.857 / 0.559 | 0.857 / 0.385 |
| `kept1+stopwords` | 0.946 | 0.982 | 0.803 | 9,433 | 20,331 | 0.855 | 0.909 | 0.720 | 9,690 | 22,799 | 0.857 / 0.524 | 0.857 / 0.476 |
| `kept1+stopwords-pt` | 0.946 | 0.982 | 0.803 | 9,433 | 20,331 | 0.855 | 0.909 | 0.720 | 9,690 | 22,799 | 0.857 / 0.571 | 0.857 / 0.457 |
| `kept1+singles` | 0.946 | 0.982 | 0.828 | 9,746 | 22,365 | 0.855 | 0.909 | 0.724 | 9,885 | 23,423 | 1.000 / 0.619 | 0.857 / 0.481 |
| `kept1+cap` | 0.946 | 0.982 | 0.819 | 9,695 | 22,413 | 0.855 | 0.909 | 0.717 | 9,961 | 23,503 | 0.857 / 0.559 | 0.857 / 0.505 |
| `kept1+selection-half` | 0.946 | 0.982 | 0.820 | 9,639 | 22,458 | 0.855 | 0.909 | 0.718 | 9,856 | 23,380 | 0.857 / 0.559 | 0.857 / 0.505 |
| `kept2+stopwords` | 0.946 | 1.000 | 0.792 | 9,477 | 20,443 | 0.855 | 0.891 | 0.718 | 9,673 | 22,854 | 1.000 / 0.548 | 0.857 / 0.412 |
| `kept2+stopwords-pt` | 0.946 | 1.000 | 0.792 | 9,477 | 20,447 | 0.855 | 0.891 | 0.718 | 9,664 | 22,851 | 0.857 / 0.571 | 0.857 / 0.457 |
| `kept2+porter` | 0.946 | 0.982 | 0.823 | 9,920 | 22,609 | 0.836 | 0.927 | 0.716 | 10,062 | 23,306 | 1.000 / 0.595 | 0.857 / 0.356 |
| `kept2+porter+stopwords-pt` | 0.946 | 0.964 | 0.824 | 9,838 | 21,187 | 0.855 | 0.873 | 0.734 | 9,891 | 22,823 | 0.857 / 0.571 | 0.857 / 0.375 |
| `kept2+cap` | 0.946 | 0.982 | 0.828 | 9,739 | 22,368 | 0.855 | 0.909 | 0.724 | 9,927 | 23,434 | 1.000 / 0.619 | 0.857 / 0.481 |
| `kept2+selection-half` | 0.946 | 0.982 | 0.829 | 9,709 | 22,404 | 0.855 | 0.909 | 0.725 | 9,861 | 23,351 | 1.000 / 0.619 | 0.857 / 0.481 |
| `current` (shipped) | 0.946 | 0.982 | 0.830 | 9,727 | 22,278 | 0.855 | 0.909 | 0.724 | 9,880 | 23,384 | 1.000 / 0.619 | 0.857 / 0.481 |

Product scope per category (recall@6 / recall@16 / MRR):

| Variant | exact | word-forms | paraphrase | selection | symbols | project | portuguese |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `baseline` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret04-porter` | 1.00 / 1.00 / 0.94 | 1.00 / 1.00 / 0.81 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.74 | 0.90 / 0.90 / 0.70 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.52 |
| `ret04-diacritics` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret05-stopwords` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.58 | 1.00 / 1.00 / 0.78 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.49 |
| `ret05-stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.58 | 1.00 / 1.00 / 0.78 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.56 |
| `ret05-rarest` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.78 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret05-singles` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.59 |
| `ret05-question-first` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret05-selection-half` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 0.89 / 1.00 / 0.70 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret06-page-context` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret07-tiebreak` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `ret07-merge` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.56 |
| `ret07-cap` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.77 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.55 |
| `kept1` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.56 |
| `kept1+porter` | 1.00 / 1.00 / 0.94 | 1.00 / 1.00 / 0.81 | 0.78 / 1.00 / 0.74 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.56 |
| `kept1+stopwords` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.58 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.52 |
| `kept1+stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.58 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.57 |
| `kept1+singles` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.62 |
| `kept1+cap` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.56 |
| `kept1+selection-half` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.77 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 0.94 | 0.86 / 0.86 / 0.56 |
| `kept2+stopwords` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.51 | 1.00 / 1.00 / 0.76 | 0.90 / 1.00 / 0.79 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.55 |
| `kept2+stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.89 / 1.00 / 0.69 | 0.89 / 1.00 / 0.51 | 1.00 / 1.00 / 0.76 | 0.90 / 1.00 / 0.79 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.57 |
| `kept2+porter` | 1.00 / 1.00 / 0.94 | 1.00 / 1.00 / 0.81 | 0.78 / 1.00 / 0.64 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.60 |
| `kept2+porter+stopwords-pt` | 1.00 / 1.00 / 0.94 | 1.00 / 1.00 / 0.89 | 0.78 / 0.89 / 0.57 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 0.86 / 0.57 |
| `kept2+cap` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.62 |
| `kept2+selection-half` | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.73 | 1.00 / 1.00 / 0.77 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.62 |
| `current` (shipped) | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 0.71 | 0.78 / 1.00 / 0.74 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.62 |

Whole library per category (recall@6 / recall@16 / MRR):

| Variant | exact | word-forms | paraphrase | selection | symbols | project | portuguese |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `baseline` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.89 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret04-porter` | 1.00 / 1.00 / 0.94 | 0.89 / 1.00 / 0.62 | 0.33 / 0.78 / 0.31 | 0.89 / 0.89 / 0.72 | 0.80 / 0.90 / 0.64 | 1.00 / 1.00 / 0.89 | 0.43 / 0.86 / 0.36 |
| `ret04-diacritics` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.89 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret05-stopwords` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.67 / 0.26 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.71 / 0.86 / 0.43 |
| `ret05-stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.67 / 0.26 | 1.00 / 1.00 / 0.75 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.71 / 0.86 / 0.44 |
| `ret05-rarest` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret05-singles` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.43 | 0.56 / 0.67 / 0.39 | 0.89 / 0.89 / 0.66 | 0.80 / 0.90 / 0.76 | 1.00 / 1.00 / 1.00 | 0.43 / 0.86 / 0.47 |
| `ret05-question-first` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.89 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret05-selection-half` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.78 / 0.89 / 0.61 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret06-page-context` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret07-tiebreak` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.89 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `ret07-merge` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.89 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.50 |
| `ret07-cap` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 0.78 / 0.89 / 0.73 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.49 |
| `kept1` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.50 |
| `kept1+porter` | 1.00 / 1.00 / 0.94 | 0.89 / 1.00 / 0.63 | 0.33 / 0.78 / 0.32 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.64 | 1.00 / 1.00 / 0.89 | 0.43 / 0.86 / 0.38 |
| `kept1+stopwords` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.67 / 0.26 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.71 / 0.86 / 0.48 |
| `kept1+stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.67 / 0.26 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.71 / 0.86 / 0.46 |
| `kept1+singles` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.43 | 0.56 / 0.67 / 0.39 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.76 | 1.00 / 1.00 / 1.00 | 0.43 / 0.86 / 0.48 |
| `kept1+cap` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.50 |
| `kept1+selection-half` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.48 | 0.56 / 0.67 / 0.40 | 1.00 / 1.00 / 0.77 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.57 / 0.86 / 0.50 |
| `kept2+stopwords` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.56 / 0.25 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.43 / 0.86 / 0.41 |
| `kept2+stopwords-pt` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.51 | 0.44 / 0.56 / 0.25 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.71 / 0.86 / 0.46 |
| `kept2+porter` | 1.00 / 1.00 / 0.94 | 0.89 / 1.00 / 0.63 | 0.33 / 0.67 / 0.31 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.71 | 1.00 / 1.00 / 0.94 | 0.43 / 0.86 / 0.36 |
| `kept2+porter+stopwords-pt` | 1.00 / 1.00 / 0.94 | 0.89 / 1.00 / 0.63 | 0.33 / 0.33 / 0.28 | 1.00 / 1.00 / 0.76 | 0.90 / 0.90 / 0.78 | 1.00 / 1.00 / 1.00 | 0.57 / 0.86 / 0.38 |
| `kept2+cap` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.43 | 0.56 / 0.67 / 0.39 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.76 | 1.00 / 1.00 / 1.00 | 0.57 / 0.86 / 0.48 |
| `kept2+selection-half` | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.43 | 0.56 / 0.67 / 0.39 | 1.00 / 1.00 / 0.77 | 0.80 / 0.90 / 0.76 | 1.00 / 1.00 / 1.00 | 0.43 / 0.86 / 0.48 |
| `current` (shipped) | 1.00 / 1.00 / 1.00 | 0.78 / 0.89 / 0.43 | 0.56 / 0.67 / 0.39 | 1.00 / 1.00 / 0.76 | 0.80 / 0.90 / 0.76 | 1.00 / 1.00 / 1.00 | 0.43 / 0.86 / 0.48 |
