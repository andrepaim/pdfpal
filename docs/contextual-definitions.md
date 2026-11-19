# Contextual definition order (English, opt-in)

Status: implemented on the feature branch `feat/ettin-definition-order`. It is not merged, published or included in a release.

With this setting on, the reader's [definition card](reader-guide.md#offline-dictionary) lists each WordNet entry's meanings in the order that best fits the passage. A local word-sense model, Ettin-150m-WSD, runs on the CPU to choose the order. In "Drag the mouse to move the cursor", the pointing-device meaning of *mouse* comes before the rodent. The card looks the same as before: it shows no marks, badges or scores, and the entries, definitions and examples do not change. The setting is off by default. It works offline, needs no account and never downloads anything.

## How it works

- **What is ordered.** Entries, meaning the compound, lemma and part-of-speech groups, keep their WordNet order. Only the meanings inside each entry are reordered, highest score first. The sort is stable, so equal scores keep WordNet order.
- **One model call per lookup.** Every meaning of every entry the card lists is offered in a single prompt. The prompt marks exactly the span you selected and includes up to 120 characters of page text on each side, the same text the dictionary already uses to find compounds. The browser's UTF-16 offsets are converted to the Unicode code points the model counts.
- **WordNet order is kept** when every entry has a single meaning (no model call), or when the model ranks "none of the above" at least as high as every meaning. It is also kept when the passage does not look English, when it contains `*` or model control tokens, when there are more than 127 meanings or more than 2,048 tokens, when the model, runtime or their files are missing or do not match, when the worker fails, and when the time budget runs out.
- **Timing.** The model loads in a background worker thread when pdfpal starts with the setting on. Lookups made before it has loaded get WordNet order immediately. Once it has loaded, a lookup waits at most 120 ms by default (`contextual_definitions_budget_ms`). The server answers once, so the card appears once, in its final order. If an answer arrives after the budget, it is cached, and selecting the same passage again uses it. Superseded and cancelled lookups are dropped. A double-click sends one lookup.
- **Privacy.** The selection and its context stay in the local pdfpal process and its worker. They are not logged, synced or sent anywhere. The cache holds only prompt hashes and numbers.

## Set it up

You need two local inputs, and neither is downloaded by pdfpal:

1. **The model:** a [sense-model](https://huggingface.co/sign/Ettin-150m-WSD) export of Ettin-150m-WSD containing `model_metadata.json`, `calibration.json`, `tokenizer.json`, `tokenizer_config.json` and `onnx/model.int8.onnx`.
2. **The runtime:** `onnxruntime-node` 1.30.0 and `@huggingface/tokenizers` 0.2.0. They are optional peer dependencies, so a default pdfpal install stays lightweight. A source checkout already has both after `npm ci`. Otherwise, install them into any separate directory (`--ignore-scripts` skips ONNX Runtime's optional CUDA download): `npm install --ignore-scripts --prefix ./sense-runtime-source onnxruntime-node@1.30.0 @huggingface/tokenizers@0.2.0`. The onnxruntime-node package includes the CPU binaries for Windows, Linux and macOS, so a directory installed on Linux or WSL can also provision a Windows library.

Then, for the library you read with:

```sh
pdfpal dictionary install-model <model-export-directory>
pdfpal dictionary install-runtime <directory-with-node_modules>   # needed by the desktop app
pdfpal dictionary enable
pdfpal dictionary status        # verifies every file; --json for scripts
```

Restart pdfpal, or the desktop app, after enabling. `pdfpal dictionary disable` restores WordNet order.

- **Desktop app (Windows x64, Linux x64).** The installed app does not include the runtime, so run `install-runtime` as well. The bundled desktop CLI runs `dictionary` commands against the default library itself, without the app. Use `--data-dir <library>` for a different library, and quit the app before reinstalling a runtime. Windows locks loaded DLLs, and the install then stops with `INSTALL_TARGET_BUSY`. To provision a Windows library from WSL, add `--platform win32-x64 --data-dir /mnt/c/Users/<you>/.pdfpal`. This only copies files; it does not share the SQLite library.
- **Source checkout or npm install.** If `onnxruntime-node` and `@huggingface/tokenizers` can be resolved next to pdfpal, `install-runtime` is optional (`status` reports the runtime as `bundled`). A provisioned runtime, when present, always takes precedence and must verify.

### Configuration

| Setting | `config.json` key | Environment | Default |
| --- | --- | --- | --- |
| On/off | `contextual_definitions` | `PDFPAL_CONTEXTUAL_DEFINITIONS` (`1`/`0`) | off |
| Wait for a ready model | `contextual_definitions_budget_ms` | `PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS` | 120 (kept within 20 to 1000) |
| Model directory | `sense_model_dir` | `PDFPAL_SENSE_MODEL_DIR` | `<library>/models/ettin-150m-wsd-int8` |
| Runtime directory | `sense_runtime_dir` | `PDFPAL_SENSE_RUNTIME_DIR` | `<library>/models/sense-runtime` |

An environment variable overrides `config.json`. Use the setting only for English documents; the dictionary itself is English.

## Pinned identity and safe installation

- **Model.** Checkpoint revision `8751b577199d1bb95b74fa2457da7065d57100ae`, dynamic INT8 ONNX export. The SHA-256 and size of each of the five files are pinned in `src/core/sense-model.ts`; `onnx/model.int8.onnx` is `8649a113…822d68`.
- **Runtime.** Every file the worker loads is pinned per platform in `src/core/sense-runtime-manifest.ts`: package metadata, JavaScript, licenses and that platform's native binaries. `node scripts/sense-runtime-manifest.mjs` regenerates the manifest from `node_modules` after a version change.
- **When files are checked.** Each install verifies the copied files, and the worker verifies them again before every load. A mismatch fails closed, and the card keeps WordNet order.
- **Installation.** Files are copied into a temporary sibling directory, verified and marked with `.pdfpal-install.json`, then swapped in by rename.
  - pdfpal only replaces a destination that is missing, empty or already marked for the same kind (model or runtime). Anything else, such as a shared folder or the export directory itself, is refused with `INSTALL_TARGET_NOT_OWNED` or `INSTALL_SAME_DIRECTORY`.
  - If the new copy cannot take the place of the old one after the old one was moved aside, the old one is moved back (`INSTALL_FAILED`). If that also fails, the old copy is kept, its location is reported (`INSTALL_ROLLBACK_FAILED`), and the next install restores it before doing anything else.
  - Locked leftovers are removed by a later install.

## Platform status and evidence

| Surface | Result | Source |
| --- | --- | --- |
| Linux/WSL2 x64, Node 22, server and real checkpoint | The real model ordered "bank" correctly for a deposit and a riverbank passage, through both the package runtime and a provisioned runtime copy | Implementing agent: `PDFPAL_TEST_SENSE_MODEL_DIR=… node --import tsx --test test/integration/sense-model-real.test.ts` |
| Windows x64, packaged Electron 45 app (unpacked build of this branch), fresh isolated profile | CLI-provisioned pinned model and win32 runtime. "mouse" in "Drag the mouse to move the cursor on screen" listed the rodent first with the setting off and the cursor-device meaning first after warm-up with it on. Order stayed stable for each open card. The Windows Node + Chrome browser path also worked. | Native check by the coordinating agent on a branch snapshot before the final commit; to be rechecked at the final SHA |
| Linux x64, packaged Electron app (electron-builder `linux-unpacked`), Xvfb/DBus, normal Chromium sandbox | CLI-installed Linux runtime and model verified; real cursor-device reordering in the PDF reader | Check by the coordinating agent on WSL2, branch snapshot before the final commit |

### Warm latency on the development machine

These numbers come from WSL2 on a 24-thread CPU with 8 inference threads, measuring the time to order the whole inventory once the model is warm. They cover this machine and these words only.

| Meanings in the inventory | Example words | Time |
| ---: | --- | ---: |
| 6–11 | network, layer, mouse, state | 35–55 ms |
| 16–18 | model, train, bank | 55–110 ms |
| 21–22 | key, field | 135–150 ms |
| 40 | charge | 235–245 ms |

The earlier 95 ms p95 measurement used inventories of 2 to 10 meanings from one part of speech. The card offers every meaning of every entry, so on this machine the 120 ms default orders words with up to about 18 meanings and falls back to WordNet order for larger inventories. A repeat lookup of the same passage then uses the cached late answer. Raising `contextual_definitions_budget_ms` trades card latency for coverage.

## Limitations

- English only, with a heuristic language check on the passage (Latin script, few accented letters, English function words). It is not language identification.
- Ordering is only as good as the model. In the offline pilot, the 64 ambiguous, answerable selections on which two model reviewers agreed were simulated picks in real paper passages, with no human labels. Moving whole entry groups put a correct meaning first in 54 of 64 cases against WordNet's 45 (+14.1 percentage points). Replayed under this card's policy, which reorders only inside entries, the result was 53 of 64 against 45 for the first meaning (+12.5 points) and 61 of 64 against 55 among the meanings visible before "Show all". The replay assumed no timeouts; the installed feature's first-lookup numbers depend on the deadline (see the latency table). When no WordNet meaning fits, the model still puts one first unless "none of the above" wins.
- Large inventories often exceed the default budget on a first lookup (see the table above).
- The installed desktop app needs the separately provisioned runtime. The app reads the setting at startup, and there is no in-app switch.
- Literal `*` within 120 characters of the selection disables ordering for that lookup, because the model's prompt format reserves it.
- The Kindle companion does not show definition cards.

## Plan

**Intended behavior.** With the flag on and a verified local model and runtime, the card orders meanings inside entries by contextual fit. Otherwise the card is the WordNet card.

**Acceptance criteria.** Default off, with documented opt-in and local provisioning. No network or paragraph disclosure. Pinned identity. One call scoring all candidates on the exact span, with code point offsets. Entry order preserved; stable within-entry sort; all content kept. No UI marks. No scoring for single-sense groups. WordNet fallback on none/tie, unsupported input, asset or runtime problems, failures and timeouts. Bounded cold and warm latency with one card render. Stale and concurrent lookups handled. Resources released. Safe repeated or failed installs that replace only owned directories. Works in the packaged Windows and Linux desktop apps.

**Affected components.** `src/core/{contextual-definitions,sense-order,sense-model,sense-runtime-manifest,sense-worker,config}.ts`, `src/server/dictionary.ts`, `src/cli/{index,standalone}.ts`, `frontend/src/components/PdfViewer.tsx`, `frontend/src/lib/api.ts`, `.npmrc`, `package.json` and documentation. There is no schema, sync, backup or desktop staging change.

**Validation.** Unit tests for ordering, offsets, safeguards, the language check, identity, provisioning failures and the worker lifecycle (fake worker). Route and server integration tests. CLI tests. Playwright tests for the card. An opt-in real-checkpoint test. Typecheck, `npm test`, build, frontend Playwright, `test:package`, documentation and secret checks.
