# Contextual definition order (English, opt-in)

The PDF reader uses the same Wiktionary lookup and sense-ordering code as [Contextual Dictionary](https://github.com/andrepaim/contextual-dictionary). Its English dictionary ships with pdfpal and works from the first offline launch. **Order by context** optionally runs the Ettin-150m-WSD model on the local CPU. For example, the sentence around *mouse* helps the model choose between the animal and the pointing device.

## How it works

- The reader sends the selection and up to 120 characters on each side to the local server. The shared core resolves inflections and compounds, groups definitions by entry, and constructs the model prompt. Matching compounds can extend beyond the selected words.
- The native worker scores the candidate meanings in one call. Each entry lists its scored meanings first, in descending order of fit. Meanings omitted from the prompt follow in dictionary order. Entry groups retain their original order. When the model chooses “none of the above” or skips a lookup, the card uses dictionary order.
- A lookup during model startup returns dictionary order immediately. Once the model is ready, pdfpal waits up to 120 ms by default. The card opens once. A late result can be reused the next time the same passage is selected.
- Selections stay on the device. Only a confirmed model or runtime download contacts the release server. An upgrade from beta.10 reuses the existing verified Ettin model and native runtime.

## Set it up

### In the reader

1. Open a PDF and click **Order by context** in the reader toolbar, next to **Definitions**. The button's accessible name is "Order meanings by context".
2. If the files are not on this computer yet, the panel shows the one-time download size: 150 MB for the model plus the runtime (18 MB on Linux x64, 11 MB on Windows x64), if pdfpal has no runtime of its own. Nothing is downloaded until you click **Download and turn on**.
3. The panel shows progress, and **Cancel** stops the download. A failed download shows why, and **Retry download** starts again. When the files are in place the setting turns on for this library immediately, without a restart. **Turn off** restores dictionary order at once.

The files come from the project's GitHub release (`dictionary-assets-v1`). Each bundle's size and SHA-256 are checked before it is opened, and every extracted file is checked against its own pin. They are stored once per user and reused by every library on the computer, even offline:

| System | Cache directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\pdfpal\sense-cache` |
| Linux | `$XDG_CACHE_HOME/pdfpal/sense-cache` (default `~/.cache/pdfpal/sense-cache`) |
| macOS | `~/Library/Caches/pdfpal/sense-cache` |

Inside it, `v1/model/<revision>-<digest>/` and `v1/runtime/<platform>/<digest>/` hold the files with their `notices/` (attribution and licenses). They are never changed after installation. A copy that fails verification is set aside and downloaded again on request. Two apps or libraries installing the same files take turns through a lock in `v1/.locks/`: one downloads, and the other then reuses that copy. Downloadable runtimes exist for Windows x64 and Linux x64. On other systems only the model can be downloaded, and only when pdfpal can already load a runtime (for example, from a source checkout).

The preference is saved in each library's `config.json`. A model or runtime installed in the library, or set with `sense_model_dir`/`sense_runtime_dir`, is used before the cache.

### From the command line

The CLI installs from local directories and never downloads anything. You need two local inputs:

1. **The model:** a [sense-model](https://huggingface.co/sign/Ettin-150m-WSD) export of Ettin-150m-WSD containing `model_metadata.json`, `calibration.json`, `tokenizer.json`, `tokenizer_config.json` and `onnx/model.int8.onnx`.
2. **The runtime:** `onnxruntime-node` 1.30.0 and `@huggingface/tokenizers` 0.2.0. They are optional peer dependencies, so a default pdfpal install stays lightweight. A source checkout already has both after `npm ci`. Otherwise, install them into any separate directory (`--ignore-scripts` skips ONNX Runtime's optional CUDA download): `npm install --ignore-scripts --prefix ./sense-runtime-source onnxruntime-node@1.30.0 @huggingface/tokenizers@0.2.0`. The onnxruntime-node package includes the CPU binaries for Windows, Linux and macOS, so a directory installed on Linux or WSL can also provision a Windows library.

Then, for the library you read with:

```sh
pdfpal dictionary install-model <model-export-directory>
pdfpal dictionary install-runtime <directory-with-node_modules>   # needed by the desktop app
pdfpal dictionary enable
pdfpal dictionary status        # verifies every file, and reports the per-user cache; --json for scripts
```

A running pdfpal reads `enable`/`disable` from the CLI when it next starts; the reader's button applies at once. `pdfpal dictionary disable` restores dictionary order.

- **Desktop app (Windows x64, Linux x64).** The installed app does not include the runtime: download it from the reader, or run `install-runtime`. The bundled desktop CLI runs `dictionary` commands against the default library itself, without the app. Use `--data-dir <library>` for a different library, and quit the app before reinstalling a runtime. Windows locks loaded DLLs, and the install then stops with `INSTALL_TARGET_BUSY`. To provision a Windows library from WSL, add `--platform win32-x64 --data-dir /mnt/c/Users/<you>/.pdfpal`. This only copies files; it does not share the SQLite library.
- **Source checkout or npm install.** If `onnxruntime-node` and `@huggingface/tokenizers` can be resolved next to pdfpal, a runtime download or `install-runtime` is optional (`status` reports the runtime as `bundled`). A provisioned runtime, when present, always takes precedence and must verify.

### Configuration

| Setting | `config.json` key | Environment | Default |
| --- | --- | --- | --- |
| On/off | `contextual_definitions` | `PDFPAL_CONTEXTUAL_DEFINITIONS` (`1`/`0`) | off |
| Wait for a ready model | `contextual_definitions_budget_ms` | `PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS` | 120 (kept within 20 to 1000) |
| Model directory | `sense_model_dir` | `PDFPAL_SENSE_MODEL_DIR` | `<library>/models/ettin-150m-wsd-int8` |
| Runtime directory | `sense_runtime_dir` | `PDFPAL_SENSE_RUNTIME_DIR` | `<library>/models/sense-runtime` |
| Per-user download cache | `sense_cache_dir` | `PDFPAL_SENSE_CACHE_DIR` | see the table above |

An environment variable overrides `config.json`. When `PDFPAL_CONTEXTUAL_DEFINITIONS` is set, the reader shows the setting as fixed and offers no actions. Use the setting only for English documents; the dictionary itself is English.

**Request boundaries.** Status (`GET /api/dictionary/contextual`) and lookups never use the network. The setting (`POST /api/dictionary/contextual`), the download (`POST …/download`, which must repeat the size the panel showed) and cancellation (`POST …/download/cancel`) accept only same-origin JSON requests from a loopback address. Cross-site pages, other local ports, `Origin: null` and form or `text/plain` posts are refused before the body is read.

## Pinned identity and safe installation

- **Model.** Checkpoint revision `8751b577199d1bb95b74fa2457da7065d57100ae`, dynamic INT8 ONNX export. The SHA-256 and size of each of the five files are pinned in `src/core/sense-model.ts`; `onnx/model.int8.onnx` is `8649a113…822d68`.
- **Runtime.** Every file the worker loads is pinned per platform in `src/core/sense-runtime-manifest.ts`: package metadata, JavaScript, licenses and that platform's native binaries. `node scripts/sense-runtime-manifest.mjs` regenerates the manifest from `node_modules` after a version change.
- **When files are checked.** Each install verifies the copied files, and the worker verifies them again before every load. A mismatch fails closed, and the card keeps dictionary order.
- **Installation.** Files are copied into a temporary sibling directory, verified and marked with `.pdfpal-install.json`, then swapped in by rename.
  - pdfpal only replaces a destination that is missing, empty or already marked for the same kind (model or runtime). Anything else, such as a shared folder or the export directory itself, is refused with `INSTALL_TARGET_NOT_OWNED` or `INSTALL_SAME_DIRECTORY`.
  - If the new copy cannot take the place of the old one after the old one was moved aside, the old one is moved back (`INSTALL_FAILED`). If that also fails, the old copy is kept, its location is reported (`INSTALL_ROLLBACK_FAILED`), and the next install restores it before doing anything else.
  - Locked leftovers are removed by a later install.

## What the reader can distinguish

When two meanings share an entry, context can move either to the top. For *mouse*, the native model ranks the input device first in “Drag the mouse to move the cursor on screen” and the rodent first in “The cat chased a mouse across the kitchen floor.” Wiktionary also separates some words by etymology. For *bank*, the financial institution and the riverbank belong to separate noun entries. Context can change the order of meanings inside either entry, but the financial entry still appears first.

### Migration checks on Linux x64

- **Offline upgrade.** Desktop beta.10’s backend provisioned the released Linux model and runtime in an isolated cache. The new backend reopened that library with contextual order enabled, verified both cached components, reached the ready state, and served four selections with zero download requests.
- **Node and Chromium parity.** With the same published pack and fixed scores, the core returned identical definitions, prompts and ordered results for *mouse*, *bank*, *neural network*, *mice* and an unknown term. A separate run used the real native checkpoint to exercise the two *mouse* contexts above.
- **First-lookup timing.** On one WSL2 machine, the 24 warm, uncached lookups in the native timing test reached the 120 ms deadline 24 times with Wiktionary (p95 wait 123.5 ms), compared with 13 times on beta.10 (p95 121.2 ms). This measures the wait for ordering, excluding dictionary lookup and rendering. The default returns dictionary order promptly, but a first lookup can miss a relevant contextual result. In a separate sweep, reducing the prompt cap from 1,600 to 600 characters brought 12 of 14 scores within the deadline and excluded the computer sense of *mouse*. The integration retains the shared candidate policy. Users can raise the model wait using the configuration above.

## Historical WordNet platform validation

The following platform and timing measurements used the WordNet dictionary shipped through desktop beta.10. Wiktionary has different entries and sense inventories.

| Platform | Check | Result |
| --- | --- | --- |
| Windows x64 | Release-candidate desktop app outside any development `node_modules`, fresh profile and library | The panel offered a 161,031,673-byte download. Afterwards "mouse" in "Drag the mouse to move the cursor on screen" listed the cursor-device meaning first, and **Turn off** restored WordNet order at once. A second library showed 0 bytes and reused the cache. |
| Linux x64 | The same check on the release-candidate desktop app | 168,200,354 bytes, with the same ordering, immediate restore and 0-byte second library. |
| Windows x64, Linux x64 | Packaged desktop apps with a CLI-provisioned model and runtime, normal Chromium sandbox | Cursor-device meaning first with the setting on, rodent first with it off; order stable for each open card. |
| Linux x64 (WSL2), Node 22 | The published bundles downloaded into an isolated cache, then the real checkpoint test | Sizes, digests and every pinned file verified, notices kept, resident memory about 135 MB during the 150 MB transfer. The real model ordered "mouse" and "bank" by context. |

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
- Ordering is only as good as the model. In the offline pilot, the 64 ambiguous, answerable selections on which two model reviewers agreed were simulated picks in real paper passages, with no human labels. Moving whole entry groups put a correct meaning first in 54 of 64 cases against WordNet's 45 (+14.1 percentage points). Replayed under the WordNet card's policy, which reorders only inside entries, the result was 53 of 64 against 45 for the first meaning (+12.5 points) and 61 of 64 against 55 among the meanings visible before "Show all". The replay assumed no timeouts; the WordNet implementation's first-lookup numbers depend on the deadline (see the latency table). When no WordNet meaning fits, the model still puts one first unless "none of the above" wins.
- Large inventories often exceed the default budget on a first lookup (see the table above).
- The download uses Node's `fetch`, which ignores system proxy settings. Behind a proxy that blocks direct HTTPS, provision from the command line instead.
- A runtime update or repair on Windows may report `INSTALL_TARGET_BUSY` while another pdfpal app has that runtime loaded.
- CLI `enable`/`disable` take effect when a running app next starts; the reader button applies at once.
- Literal `*` within 120 characters of the selection disables ordering for that lookup, because the model's prompt format reserves it.
- The Kindle companion does not show definition cards.

## Original WordNet implementation plan

**Intended behavior.** With the flag on and a verified local model and runtime, the card orders meanings inside entries by contextual fit. Otherwise the card is the WordNet card.

**Acceptance criteria.** Default off, with documented opt-in and local provisioning. No network or paragraph disclosure. Pinned identity. One call scoring all candidates on the exact span, with code point offsets. Entry order preserved; stable within-entry sort; all content kept. No UI marks. No scoring for single-sense groups. WordNet fallback on none/tie, unsupported input, asset or runtime problems, failures and timeouts. Bounded cold and warm latency with one card render. Stale and concurrent lookups handled. Resources released. Safe repeated or failed installs that replace only owned directories. Works in the packaged Windows and Linux desktop apps.

**Affected components.** `src/core/{contextual-definitions,sense-order,sense-model,sense-runtime-manifest,sense-worker,config}.ts`, `src/server/dictionary.ts`, `src/cli/{index,standalone}.ts`, `frontend/src/components/PdfViewer.tsx`, `frontend/src/lib/api.ts`, `.npmrc`, `package.json` and documentation. There is no schema, sync, backup or desktop staging change.

**Validation.** Unit tests for ordering, offsets, safeguards, the language check, identity, provisioning failures and the worker lifecycle (fake worker). Route and server integration tests. CLI tests. Playwright tests for the card. An opt-in real-checkpoint test. Typecheck, `npm test`, build, frontend Playwright, `test:package`, documentation and secret checks.

## Original in-app opt-in and one-time download plan (stage 2)

**Intended behavior.** The reader toolbar gets an explicit **Order meanings by context** control. Turning it on when the model or runtime is missing shows the one-time download size and asks for confirmation. Only then does pdfpal download the pinned bundles from the project's GitHub release, with progress, cancel, retry and clear errors. The files go into a per-user, versioned, immutable cache that every library on the machine reuses, offline too. The setting takes effect immediately, without a restart, and is saved per library. Existing library installs, `--data-dir` libraries and `sense_*`/`PDFPAL_*` overrides keep working and take precedence over the cache.

**Acceptance criteria.**

- **Network use.** Only `POST /api/dictionary/contextual/download`, sent from the local UI with the size it showed, uses the network. Lookups, status and enabling from a complete cache never do.
- **State changes.** Every state-changing route requires a loopback Host, a same-origin or absent `Origin`, a `Sec-Fetch-Site` of same-origin or none (or absent), and a JSON body. Cross-site and drive-by form POSTs are refused.
- **Bundle checks.** A bundle's outer size and SHA-256 are verified on disk before it is opened. ZIP entries are read from disk by streaming, without loading the archive into memory. Only stored or deflate entries are accepted, only allowlisted names (pinned model paths, `node_modules/<pinned runtime path>` for this platform, and optional `notices/`). Encrypted, ZIP64, traversal, duplicate and size-mismatched entries are rejected. After extraction every pinned file is verified, and so is a reused cache entry before it is accepted.
- **Platforms.** Downloadable runtimes exist for win32-x64 and linux-x64 only. Elsewhere, only the model can be downloaded, and only when a runtime is already available.
- **Concurrency and failure.** Concurrent apps or libraries installing the same bundle, truncated or malformed downloads, disk errors and cancellation never leave a partial cache entry, because the verified directory is put in place with one rename. A cache entry that fails verification is set aside and downloaded again.
- **Lookups fail open.** The card keeps WordNet order whenever anything is missing, loading or failing.

**Affected components.** `src/core/{zip-extract,sense-download,contextual-service,config}.ts`, `src/server/dictionary.ts`, `frontend/src/components/{ContextOrderControl,PdfViewer}.tsx`, `frontend/src/lib/api.ts`, tests and documentation.

**Validation.** ZIP reader tests with fflate-built archives (stored, deflate, truncated, corrupt, hostile names). Download tests with a mocked `fetch` covering progress, truncation, digest mismatch, HTTP errors, cancellation, stalls, concurrent installs, offline reuse and a tampered cache. Service and route tests for preference, immediate effect, environment lock, cross-library reuse and origin enforcement. Playwright tests for the reader control (size before confirmation, progress, error/retry, disable). Typecheck, `npm test`, build, frontend Playwright and `test:package`.
