# Reading with pdfpal

Start with the [PDF quickstart](../README.md#read-a-pdf) to create a project and import a paper. This guide covers the current PDF reader; [Kindle capture](../extension/README.md#capture-a-passage) has its own workflow.

## Selections, questions and highlights

Select a passage of three or more words to open the action menu. **Explain** opens reader chat and immediately asks your selected assistant to explain the passage in plain language using its page context. **Ask…** attaches the passage so you can write your own question, **Highlight** saves it, and **Explain visually** starts a [visual explanation](visual-explanations.md). A selection spanning a page break is highlighted as separate rectangles on each page. The project **Highlights** view groups saved annotations by source and opens their reading context.

Questions about a selected passage use the selection's page and neighboring pages when available, plus relevant indexed passages. This improves context around formulas and definitions; it does not send the entire project or guarantee a correct answer. Reading calls disable the assistant's shell and web tools. Use **Related** or paper search for discovery, or have an external research agent collect sources first.

In the desktop app, open **AI settings** to choose a default model for Claude Code or Codex. Choose **Automatic** to let the assistant pick, or enter a custom model ID your account can use. ChatGPT lists the models available to your connected account.

To switch models for one paper, open its **AI Chat** tab and use the model menu beside the assistant. PDFPal remembers the choice for that paper and assistant on this device. Your next question, **Explain**, or **Explain visually** uses that model. Choose **Use default** to follow the assistant’s settings again.

**Project Chat** asks across indexed project sources. Toggle sources or select a collection to narrow its scope. Kindle source entries hold book references, not full book text, so adding one does not make the whole book searchable in project chat. See the [retrieval baseline](retrieval-baseline.md) for measured coverage and limitations.

## Offline dictionary

Double-click an English word, or select one or two words. When the bundled English Wiktionary dictionary has an entry, the reader shows just its definition card. It recognizes base forms such as “mouse” for “mice”, hyphenated words and listed compounds such as “neural network”. A word inside a listed compound can show that compound before the individual word.

**Show all meanings** expands the card and **Show fewer** collapses it. Press **Escape** or click elsewhere to dismiss it. If a lookup fails or finds no entry, choose **Explain** to ask about the selected text. Select three or more words to open the full action menu, including **Ask** and **Highlight**.

Open **Reading preferences** with the sliders icon in the reader toolbar. Turn off **Show definitions on selection** to use the full action menu for selections of any length. The browser remembers this choice. Definitions work locally without an AI account, provider call or network lookup. The card credits Wiktionary and can show an inflection note such as “plural of mouse.”

**Show the best-fitting meaning first** uses a local English model to order the meanings within each entry. It's off by default and the library remembers its setting while definitions are off. If a download is needed, the panel shows its size and waits for you to choose **Download and turn on**. Every library on the computer can reuse the verified files offline. The card uses dictionary order while the model starts or when it cannot choose a meaning. The Kindle companion does not include the PDF definition card. See [contextual definition order](contextual-definitions.md) for setup details.

## Page appearance and navigation

In **Reading preferences**, **Dark pages** under **Appearance** changes the page background and text colors. Switch it off to see original colors in figures and photos. The browser remembers the choice across documents and reloads.

Reading progress restores the last page for each source. After following an internal PDF reference link, **Back to citation** returns to the previous position and zoom. Repeated reference jumps can be retraced in order. This control is separate from the desktop's back/forward reading history.

Drag the divider to resize the PDF and chat/notes panes. Per-source conversations persist locally, and **Notes** lets you save your own Markdown explanation. [Backups](backup-recovery.md) preserve the full library; [optional cloud sync](firebase-setup.md) has a narrower scope and separate consent controls.
