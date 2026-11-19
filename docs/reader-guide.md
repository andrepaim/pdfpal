# Reading with pdfpal

Start with the [PDF quickstart](../README.md#read-a-pdf) to create a project and import a paper. This guide covers the current PDF reader; [Kindle capture](../extension/README.md#capture-a-passage) has its own workflow.

## Selections, questions and highlights

Select PDF text to open the popup. **Ask** attaches it to your next question, **Highlight** saves it, and **Explain visually** starts a [visual explanation](visual-explanations.md). A selection spanning a page break is highlighted as separate rectangles on each page. The project **Highlights** view groups saved annotations by source and opens their reading context.

Questions about a selected passage use the selection's page and neighboring pages when available, plus relevant indexed passages. This improves context around formulas and definitions; it does not send the entire project or guarantee a correct answer. Reading calls disable the assistant's shell and web tools. Use **Related** or paper search for discovery, or have an external research agent collect sources first.

**Project Chat** asks across indexed project sources. Toggle sources or select a collection to narrow its scope. Kindle source entries hold book references, not full book text, so adding one does not make the whole book searchable in project chat. See the [retrieval baseline](retrieval-baseline.md) for measured coverage and limitations.

## Offline dictionary

Double-click an English word, or select a short phrase. When the bundled WordNet 3.1 dictionary has an entry, a definition card appears next to the selection popup. It recognizes base forms such as “mouse” for “mice”, hyphenated words and listed compounds such as “neural network”. A word inside a listed compound can show that compound before the individual word.

**Show all meanings** expands the card; **Show fewer** collapses it. Press **Escape** or click elsewhere to dismiss it. **Ask** and **Highlight** remain available for the selected text. Unknown terms show no card; long selections keep the normal selection actions without a dictionary lookup.

**Definitions** in the reader toolbar toggles these cards. The choice is remembered in the current browser. Definitions work locally without an AI account, provider call or network lookup. They are English dictionary entries, not AI explanations; use Ask for specialized terminology or a meaning that does not fit the passage.

**Order by context**, next to **Definitions**, turns on [contextual definition order](contextual-definitions.md) for the library. A local English word-sense model then lists each entry's best-fitting meaning first, and nothing else on the card changes. It is off by default. Turning it on the first time offers a one-time download (about 161 MB on Windows x64, 168 MB on Linux x64), which starts only after you confirm. Every library on the computer reuses the download, offline too. Whenever the model is not ready or cannot decide, the card keeps WordNet order. The Kindle companion does not include this PDF dictionary card.

## Page appearance and navigation

**Dark pages**, beside the zoom controls, changes the page background and text colors. It also changes figure and photo colors; switch it off to inspect original colors. The browser remembers the choice across documents and reloads.

Reading progress restores the last page for each source. After following an internal PDF reference link, **Back to citation** returns to the previous position and zoom. Repeated reference jumps can be retraced in order. This control is separate from the desktop's back/forward reading history.

Drag the divider to resize the PDF and chat/notes panes. Per-source conversations persist locally, and **Notes** lets you save your own Markdown explanation. [Backups](backup-recovery.md) preserve the full library; [optional cloud sync](firebase-setup.md) has a narrower scope and separate consent controls.
