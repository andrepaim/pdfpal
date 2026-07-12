---
name: pdfpal-cli
description: Drive the pdfpal CLI to manage local PDF research projects — create/rename/delete projects, add PDF sources (from a URL or a local file) and organize them into nested collections, move/rename/remove sources, write/edit markdown notes, full-text search within a project, list highlights, and ask project-scoped questions. Use whenever asked to build or maintain a pdfpal project, e.g. "create a pdfpal project for a topic and add these papers", "add this PDF to my pdfpal project", "write a note in my pdfpal project explaining X", "remove this source from pdfpal", "what's in my pdfpal project". Requires the pdfpal CLI on PATH (npm install -g pdfpal). Does NOT search for papers — pdfpal has no paper-discovery command; find papers yourself first, then use this skill to ingest them.
---

# pdfpal CLI

Local PDF research assistant. Every action below is a real `pdfpal` subcommand — verify with `pdfpal --version` before use.

## Golden rules

1. **Always pass `--json`** (global flag, goes right after `pdfpal`, e.g. `pdfpal --json project create "..."`). Without it, output is a human `console.table`/plain-text format that is not reliable to parse.
2. **Always pass `-y`/`--yes` on destructive commands** (`project delete`, `source remove`, `collection delete`, `note delete`). Running non-interactively without it throws `CONFIRMATION_REQUIRED` (exit code 2) — there is no prompt to answer.
3. **Selectors** (`<project>`, `<source>`, `<collection>`) accept either the resource's UUID or its exact, case-insensitive title. Prefer capturing the `id` from a `--json` response and reusing it for later commands on the same resource, rather than re-resolving by title each time — titles are not guaranteed unique.
4. **Exit codes**: `0` success, `1` unexpected error, `2` validation error or confirmation required, `3` not found, `4` ambiguous selector (title matched more than one resource) or conflict (e.g. moving a source to the project it's already in). On exit 4 from an ambiguous title, the JSON error `details` lists the matching `{id, title}` pairs — pick one and use its `id`.
5. **This skill has no paper-discovery step.** pdfpal has no CLI command to search the web for papers. Find the papers first (your own search), then use `source add` with each paper's URL (arXiv, OpenReview, ACL Anthology, PMLR, DOI, or any direct `.pdf` link — pdfpal auto-rewrites common paper-page URLs to their PDF) or a local file path.
6. **This operates on the user's real local data** by default (`~/.pdfpal`, unless `PDFPAL_DATA_DIR`/`PDFPAL_DB` is set). Confirm with the user before deleting an existing project or source unless they've already told you to.

## Primary workflow: build a project from a list of papers

```bash
# 1. Create the project, capture its id
pdfpal --json project create "Attention Mechanisms"
# -> { "id": "<project-id>", "title": "Attention Mechanisms", ... }

# 2. Add each paper (URL or local file). Title is auto-extracted from the PDF
#    if you omit -t/--title; pass it explicitly when you already know the
#    correct title and don't want to rely on extraction.
pdfpal --json source add <project-id> "https://arxiv.org/abs/1706.03762"
pdfpal --json source add <project-id> "https://arxiv.org/abs/2005.14165" -t "GPT-3"
pdfpal --json source add <project-id> "/path/to/local/paper.pdf"

# 3. Optional: organize into (nested) collections
pdfpal --json collection create <project-id> "Transformers"
pdfpal --json source file <project-id> <source-id> <collection-id>

# 4. Verify
pdfpal --json source list <project-id>
```

Each `source add` returns the created source's `id`, `title`, `pages`, and extracted `pdf_text`. A source with `"pages": 0` and no `pdf_text` means extraction failed (e.g. a scanned PDF, or the URL didn't resolve to a real PDF) — report that to the user rather than silently continuing.

Before adding, check `pdfpal --json source list <project-id>` to avoid adding the same paper twice — `source add` does not deduplicate by URL.

## Full command reference

All commands accept `<project>`/`<source>`/`<collection>` as UUID or exact case-insensitive title (see Golden rule 3).

### Projects

| Command | Notes |
|---|---|
| `pdfpal project list` | All projects, with `source_count`/`note_count`/`chat_count`. |
| `pdfpal project show <project>` | Single project. |
| `pdfpal project create <title> [-d, --description <text>]` | Returns the new project with its `id`. |
| `pdfpal project rename <project> <title>` | |
| `pdfpal project delete <project> [-y, --yes]` | Deletes the project and everything in it (sources, notes, chats, collections). Destructive — see Golden rule 2 and 6. |

### Sources

| Command | Notes |
|---|---|
| `pdfpal source list <project>` | |
| `pdfpal source show <project> <source>` | |
| `pdfpal source add <project> <url-or-file> [-t, --title <text>] [-c, --collection <collection>]` | `url-or-file` is an HTTP(S) URL or a local filesystem path. |
| `pdfpal source file <project> <source> [collection]` | Files a source into a collection; omit `collection` to unfile it. |
| `pdfpal source rename <project> <source> <title>` | |
| `pdfpal source move <project> <source> <target-project>` | Moves to a different project; unfiles it from any collection (collections are project-scoped). |
| `pdfpal source remove <project> <source> [-y, --yes]` | Destructive — see Golden rule 2 and 6. |
| `pdfpal source reindex <project> [source] [--refetch]` | Re-runs full-text indexing; `--refetch` re-downloads/re-reads the PDF first. Omit `source` to reindex every source in the project. |

### Collections (nested folders for sources)

| Command | Notes |
|---|---|
| `pdfpal collection list <project>` | |
| `pdfpal collection create <project> <name> [-p, --parent <collection>]` | Omit `--parent` for a top-level collection. |
| `pdfpal collection rename <project> <collection> <name>` | |
| `pdfpal collection move <project> <collection> [parent]` | Reparents it; omit `parent` to move it to the top level. |
| `pdfpal collection reorder <project> <collection> <position>` | Sets its 0-based sort position among sibling collections — renaming alone does not change display order, since that's driven by this position (then creation time), not by name. |
| `pdfpal collection delete <project> <collection> [-y, --yes]` | Its sources become unfiled, not deleted. Destructive — see Golden rule 2 and 6. |

### Notes

Markdown notes attached to a project (and optionally to one of its sources).

| Command | Notes |
|---|---|
| `pdfpal note list <project>` | |
| `pdfpal note show <project> <note>` | |
| `pdfpal note create <project> [-t, --title <text>] [-c, --content <text>] [-s, --source <source>]` | Reads content from stdin when `--content` is omitted — the natural way to pass multi-line markdown, e.g. `pdfpal --json note create <project> -t "Title" <<< "$content"` or piping a file. `--source` optionally attaches the note to a source. |
| `pdfpal note rename <project> <note> <title>` | Title only; content is untouched. |
| `pdfpal note edit <project> <note> [-c, --content <text>]` | Replaces the note's content (title untouched); reads from stdin when `--content` is omitted. |
| `pdfpal note delete <project> <note> [-y, --yes]` | Destructive — see Golden rule 2 and 6. |

### Search, highlights, and Q&A

| Command | Notes |
|---|---|
| `pdfpal search <project> <query> [-l, --limit <number>]` | Full-text search over already-indexed source text within one project. This is NOT paper discovery — it only searches sources already added. |
| `pdfpal highlights <project>` | Every annotation in the project, grouped by source. |
| `pdfpal ask <project> [question] [-s, --source <source...>] [-c, --collection <collection>] [-a, --agent <claude\|codex\|opencode>] [-m, --model <model>] [--no-web]` | Answers a question using the project's indexed sources via a configured agent subprocess (`claude`/`codex`/`opencode`, whichever is installed/authenticated). Reads the question from stdin if omitted. `--no-web` disables Tavily web augmentation. Can be slow (spawns a subprocess) — not needed for building a project, only for querying it afterward. |

### Server (not needed for CLI-only workflows)

`pdfpal serve [-p, --port <number>] [--no-open]` starts the local web app (default `http://localhost:8200`). Running `pdfpal` with no arguments is equivalent to `pdfpal serve`.
