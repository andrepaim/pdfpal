# Focus plan: Windows readers and retrieval quality

Status: in progress as of 2026-11-14. The engineering tasks that need no Windows machine or participants are implemented; see Progress. Baseline is desktop `2.7.0-preview.2`.

## Progress (2026-11-14)

| Task | State |
| --- | --- |
| FOCUS-01 | Done. Android is parked on the local branch `feat/mobile-android`; `CLAUDE.md` is refreshed. |
| BETA-02 | Done. The recorder and `beta-report.mjs` handle a ChatGPT sign-in starting point. Its activation target is not yet set, so the report shows `target-not-defined`. |
| BETA-03 | Done. "Send feedback" is in the app menu. Opening the system browser from the installed Windows app still needs a manual check. |
| RET-01 to RET-03 | Done. Ten CC BY 4.0 works, 72 labelled questions (10 held out), `npm run eval:retrieval`. Paper text is not committed; `npm run eval:retrieval:fetch` downloads it into a git-ignored cache. |
| RET-04 | Rejected. Stemming fixed word-form questions but lost two paraphrase questions, so no schema change shipped. |
| RET-05 | Kept: rarest-term selection and one-character terms. Rejected: stopword removal and selection-word weighting. |
| RET-06 | Kept. The reader sends the selection's page; that page and its neighbours lead the context. |
| RET-07 | Kept: merging overlapping chunks and a deterministic tie-breaker. Rejected: per-source cap (this corpus cannot show its effect). |
| RET-08 | Open. Paraphrase is still the weakest category: across the whole library the right page is in the top 16 for 67% of questions. |
| RET-09 | Not run. It needs a real assistant. |
| BETA-04 | Started. `2.8.0-beta.1` is cut as the beta baseline. `2.8.0-beta.2` adds only the fix for highlights across a page break. The M4 measurements have not been re-run on either. |
| BETA-01, BETA-05 to BETA-10 | Not started. |

Whole-library results moved from 83.6% to 85.5% (right page in the top 6) and from 0.711 to 0.724 (mean reciprocal rank). That is one more question out of 55; treat it as a small, safe step. Every variant, kept or rejected, is recorded in [the retrieval baseline](retrieval-baseline.md).

## Why this plan

pdfpal has five surfaces and no observed readers. The Windows beta tooling from M4 is built, but participant outcomes still number zero ([M4 results](windows-m4-results.md)), and the six newest preview installers have 2–4 downloads each. Retrieval decides what the assistant sees, yet it has two unit tests of its own and no quality measurement.

This plan does two things and parks the rest:

1. **Track A:** run the Windows beta that [the desktop plan](windows-desktop-plan.md) already defines (WIN-20), with the gaps closed that currently prevent it.
2. **Track B:** measure retrieval, then improve it, keeping only changes the measurement supports.

It does not redefine the beta targets, signing approach, or release gates. Those stay in the [desktop plan](windows-desktop-plan.md#success-metrics), [beta field guide](windows-beta-guide.md) and [signing plan](windows-code-signing-plan.md).

## Parked until the beta decision

| Parked | State to preserve |
| --- | --- |
| Android app | Stop at `0.2.0-alpha`. The work is uncommitted; move it to a branch so it is not lost (FOCUS-01). |
| [Multi-format sources](multi-format-sources-spec.md), [extension-first-class tasks](extension-first-class-tasks.md) | Specs stay as written. No implementation. |
| New cloud-sync, CLI-skill or Kindle features | Bug fixes only, and only when a beta participant hits them. |
| Embedding-based retrieval | Out of scope by product constraint. Revisit only if Track B shows a lexical ceiling (RET-08). |

The rule during the beta: a change ships only if it fixes a release blocker, removes an observed activation barrier, or is a Track B change that passed its evaluation.

## Track A: Windows in front of readers

### What already exists

- Automatic preview publishing to GitHub Releases, with checksums and a manifest.
- A beta kit builder, a local session recorder, and `beta-report.mjs` for aggregation.
- Targets by cohort: activation, time to first answer, usefulness, 14-day return use.
- Measured startup, memory and tray reliability on the development machine.

### Gaps found

- **The kit predates ChatGPT sign-in.** The recorder's assistant list is Claude Code, Codex, or reading without AI, and the field guide says to use a Claude Code or Codex account. "Continue with ChatGPT" is now the README's first-listed path and the only one that needs no assistant install, so the readers most worth observing cannot be recorded correctly.
- **Nothing has been accepted on a clean Windows account.** Measurements and provider checks ran on the development account.
- **No signing provider is configured.** The SignPath application has an unknown wait and has not been sent.
- **There is no way for a reader to reach the maintainer from the app.** The reader and desktop sources contain no feedback entry point, so an unobserved reader who gets stuck leaves no trace.
- **The measured baseline is stale.** M4 measured `2.1.0-preview.3`; ChatGPT sign-in, cloud sync, the CLI skill and collections have shipped since.

### Tasks

Sizes follow the desktop plan: S is contained, M spans several components, L crosses runtime or packaging boundaries.

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FOCUS-01 | Park Android on a branch; move the two book PDFs out of the repository root; refresh `CLAUDE.md` to describe the current surfaces | S | — | `master` working tree is clean; `CLAUDE.md` no longer says "no OAuth" |
| BETA-01 | Send the SignPath Foundation application (signing plan, task 1) | S | — | Application submitted; date and reference recorded in the signing plan |
| BETA-02 | Add a ChatGPT cohort to the recorder, `beta-report.mjs`, the field guide and the kit quickstart. Report activation separately for three starting points: ChatGPT sign-in, assistant already installed, assistant install needed | M | — | Recorder and report tests cover the new cohort; a ChatGPT session round-trips through save, follow-up and aggregation |
| BETA-03 | Add "Send feedback" to the app menu. It opens a prefilled GitHub issue in the system browser and attaches nothing automatically | S | — | Browser test shows the link carries only app version and Windows version; no library content, paths or account data |
| BETA-04 | Cut `2.8.0-beta.1` as the beta baseline and re-run `windows-m4.ps1` against it | M | BETA-02, BETA-03 | New measurement receipt; any budget regression against M4 is explained or fixed |
| BETA-05 | Clean-account acceptance on a fresh Windows 11 account or VM: install, each promoted provider's sign-in, first answer, close and reopen, upgrade, uninstall and reinstall | M | BETA-04 | Redacted acceptance note per provider with provider version and auth mode, as the field guide requires |
| BETA-06 | Wave 0: three to five observed sessions with readers you know, at least two nontechnical, at least two on ChatGPT sign-in | M | BETA-05 | Session reports saved; every barrier triaged as blocker, activation barrier, or deferred |
| BETA-07 | Fix wave 0 blockers and activation barriers; publish the next beta build | M | BETA-06 | Each fix names the session that exposed it; installer acceptance matrix passes |
| BETA-08 | Wave 1: recruit to the field guide's cohort (at least 20 eligible readers, at least 10 nontechnical) across the three starting points | L | BETA-07 | At least 20 activated participants with a recorded build version |
| BETA-09 | 14-day follow-ups, then `beta-report.mjs` and a written release decision against the desktop plan's targets | M | BETA-08 | Decision note with raw counts by cohort, misses stated plainly, and the next action |
| BETA-10 | When signing is approved: signed candidate, then signed previews (signing plan, tasks 2–7) | M | BETA-01 | Valid timestamped signatures on app and installer; public download verified |

### Decisions built into this track

- **Supervised sessions do not wait for signing.** An observer is present for the unknown-publisher prompt, and the field guide already treats the unsigned kit as a supervised test, not a public release. Signing remains a gate for any broad or unsupervised promotion, as the desktop plan states.
- **Wave 0 exists to test the kit, not the product.** Its sessions count toward the totals, but its purpose is to find problems in the recorder, quickstart and setup before 20 people's time is spent.
- **Every report must carry the build version.** Track B changes what answers look like, so usefulness ratings are only comparable within a build. Confirm the recorder writes it during BETA-02.
- **Recheck provider instructions before BETA-05.** The ChatGPT connection relies on [OpenAI's documented sign-in flow](windows-chatgpt-plan.md); confirm eligibility wording and limits are still current before inviting readers to it.

## Track B: retrieval quality

### How retrieval works today

- Text is split per page into 1,500-character chunks with 150 characters of overlap (`src/core/retrieval.ts`).
- The FTS5 index uses the default tokenizer, so there is no stemming: a question about "masking" does not match a passage that says "masked".
- A query is the first 16 unique words of the question, joined with OR. An attached selection is appended to the question, so a long question or selection pushes later, possibly rarer, words out.
- Common words are not removed; ranking relies on BM25 alone.
- Reader chat takes the top 16 chunks; visual explanations and Kindle research take the top 6.
- The reader does not send the page the selection came from, so nearby context is found only if it shares words with the question.
- When nothing matches, chat falls back to the first 15,000 characters of up to four sources.

Five call sites share one `search` method: reader and project chat, visual explanations, Kindle research, project search, and the CLI.

### Step 1: measure before changing anything

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| RET-01 | Evaluation corpus: 8–12 open-access papers and one long technical book chapter. Use only CC BY or public-domain works and record each licence. The paper text is downloaded into a git-ignored cache and is not committed | M | — | Manifest lists title, source URL, licence and SHA-256 |
| RET-02 | Question set: about 60 questions, each labelled with the source and page or pages that answer it | M | RET-01 | Labels reviewed by reading the cited page, not by running the current search |
| RET-03 | `npm run eval:retrieval`: prints recall at 6, recall at 16 and mean reciprocal rank, overall and per category. Offline, deterministic, separate from `npm test` | M | RET-02 | Baseline numbers for the current implementation committed as `docs/retrieval-baseline.md` |

Question categories, about ten each, chosen to match how readers actually ask:

- **Exact terms:** the question uses the paper's wording.
- **Word forms:** mask / masked / masking, normalise / normalization.
- **Paraphrase:** the question shares few words with the answer.
- **Selection attached:** a quoted passage plus a short question such as "why is this needed?".
- **Symbols and identifiers:** `d_k`, `BERT-base`, equation references, hyphenated terms.
- **Across a project:** the answer is in one of several similar papers.

Add a handful of Portuguese questions over an English paper and note the result. Porter stemming is English-only, so this shows whether non-English readers are affected before a tokenizer is chosen.

### Step 2: candidate changes, in order

Each change is evaluated alone against the baseline and kept only if it improves the overall score without lowering any category by more than a small margin. Record the numbers for rejected changes too.

| ID | Change | Size | Notes |
| --- | --- | --- | --- |
| RET-04 | Stemming tokenizer: `porter unicode61 remove_diacritics 2` | M | Verified to work with the bundled SQLite 3.53.2. Needs schema version 16: drop and recreate the FTS table and its triggers, then rebuild from `source_chunks`. No PDF re-extraction. The pre-migration backup and newer-schema guard already cover rollback. Chunks are derived locally and not synced, so cloud sync is unaffected. |
| RET-05 | Query building: drop stopwords, keep the rarest terms instead of the first 16, weight question words above selection words | M | Term rarity can come from an `fts5vocab` table. No schema change beyond that. |
| RET-06 | Page-aware context: the reader sends the selection's page; that page and its neighbours are always included ahead of search results | M | Touches `/api/chat`, the visual route and the frontend. Benefits the "selection attached" category most. |
| RET-07 | Result shaping: merge overlapping adjacent chunks, cap chunks per source in project chat | S | Frees context budget; measure context characters used as well as recall. |
| RET-08 | Decision point on the paraphrase category | S | If paraphrase recall is still poor after RET-04 to RET-07, write up options (query expansion by the assistant, or a local embedding model) with costs. Do not build either under this plan. |

Sentence-boundary chunking is deliberately not on the list: it forces a full re-index for an unmeasured gain. Add it only if the evaluation shows answers being cut mid-chunk.

### Step 3: check answers, not only passages

| ID | Task and deliverable | Size | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| RET-09 | Manual answer check: 15 questions from the set, asked through the real app with the maintainer's own assistant, before and after the kept changes. Grade each answer on two points: is it grounded in the passage, and does it cite the right page | S | RET-04 to RET-07 | Before and after grades in `docs/retrieval-baseline.md`; assistant and model recorded |

This stays manual because assistants must be mocked in automated tests. The beta's usefulness rating is the field measure of the same thing.

### Constraints

- Lexical retrieval over SQLite FTS5 only; no embedding API.
- The evaluation never touches the real home library and makes no network requests.
- The migration must pass the existing database-migration tests, including upgrade from a populated version-15 library and refusal by an older binary.
- A retrieval change reaches beta participants only in a new, recorded build.

## Sequencing

The two tracks touch different code and can run side by side. Two waits are outside our control: SignPath's review, and the 14 days between a participant's first session and their follow-up.

| Phase | Track A | Track B |
| --- | --- | --- |
| 1. Prepare | FOCUS-01, BETA-01, BETA-02, BETA-03 | RET-01, RET-02, RET-03 |
| 2. Baseline | BETA-04, BETA-05 | RET-04, RET-05 |
| 3. Wave 0 | BETA-06, BETA-07 | RET-06, RET-07, RET-09 |
| 4. Wave 1 | BETA-08 | Kept changes ship in the wave 1 build; RET-08 |
| 5. Decide | BETA-09; BETA-10 whenever signing clears | — |

Rough effort for one maintainer: two to three focused weeks for phases 1–3, then wave 1 recruiting and the follow-up window, which is mostly waiting. This is an estimate, not a commitment; re-estimate after wave 0.

Retrieval changes should land before wave 1 starts. If they are not ready, run wave 1 on the old retrieval and ship them afterwards, so one cohort is not split across two answer qualities.

## Risks

| Risk | Response |
| --- | --- |
| Recruiting 20 readers, 10 of them nontechnical, takes longer than the engineering | Start asking during phase 1. Wave 0 participants can refer others. Report honestly as "insufficient sample" if the cohort falls short, as the report tool already does. |
| SignPath declines or takes months | The supervised beta proceeds unsigned. If declined, price the paid alternative in the signing plan before BETA-09 so the release decision is not blocked on research. |
| The evaluation set is tuned to the changes | Write and label questions (RET-02) before trying any change, and hold back ten questions that are only scored at RET-09. |
| Stemming hurts identifiers or non-English text | The symbols category and the Portuguese questions exist to catch this; RET-04 is dropped or adjusted if they regress. |
| Beta feedback pulls toward new features | Apply the parked-work rule above. Log requests in the decision note for after BETA-09. |

## Done when

- At least 20 activated readers have a recorded session and a resolved 14-day follow-up, and a written release decision compares the raw counts with the desktop plan's targets.
- A signing application has an answer, and signed previews exist or a paid alternative has been chosen.
- Retrieval has a committed baseline, a repeatable evaluation, and before-and-after numbers for every change kept or rejected.
- Nothing in the parked list was built along the way.
