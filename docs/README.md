# pdfpal documentation

Start with the [project README](../README.md) for installation, a PDF/Kindle walkthrough and CLI examples. This index describes features merged into the default branch, `master`. A feature branch or a roadmap checkbox is not a released feature. Desktop versions live in [`desktop/version.json`](../desktop/version.json); the source/npm version is independent.

## Reading and managing a library

| Task | Guide |
| --- | --- |
| Install and use the Windows desktop preview | [Windows quickstart](windows-quickstart.md) |
| Build/install the x86-64 Debian desktop engineering preview | [Linux quickstart](linux-quickstart.md) |
| Run the CLI and browser reader on Linux/WSL | [Source installation](../README.md#linux-and-wsl), [CLI skill reference](../skills/pdfpal-cli/SKILL.md) |
| Step through a visual explanation, save it or export it | [Visual explanations](visual-explanations.md) |
| Turn a highlight, a region or a whole paper into a post | [Sharing posts](share-posts.md) |
| Define an English word without an AI request | [Offline dictionary](reader-guide.md#offline-dictionary) |
| Order definitions by the passage with a local model (English, opt-in, one-time download) | [Contextual definition order](contextual-definitions.md) |
| Understand selection context, citations and project chat | [Reader guide](reader-guide.md) |
| Connect Kindle for Web, capture text and troubleshoot OCR | [Kindle companion](../extension/README.md) |
| Use the Windows bundled CLI or ChatGPT skill | [Windows CLI](windows-cli.md) |
| Back up, undo deletions or recover a separate library | [Backup and recovery](backup-recovery.md) |
| Connect devices to the same cloud library | [Cloud sync and supported data](firebase-setup.md) |
| Control local diagnostics and optional error sharing | [Error reporting](error-reports.md) |

The current desktop targets are Windows x64 and a Linux x86-64 engineering preview. Mac packaging and mobile work are not merged into this branch. The standalone browser reader and CLI remain available without Electron. Preview limitations and outstanding manual checks are recorded in each platform's guide.

## Contributing and operating releases

| Task | Guide |
| --- | --- |
| Understand services, storage, commands and constraints | [Developer guide](../CLAUDE.md), [architecture](../README.md#architecture) |
| Build and validate desktop packages | [Desktop guide](../desktop/README.md) |
| Publish Windows and Linux together | [Coordinated desktop release pipeline](windows-release-pipeline.md) |
| Run the Windows beta field-test kit | [Observer guide](windows-beta-guide.md), [M4 measurements](windows-m4-results.md) |
| Reproduce the retrieval evaluation | [Retrieval baseline](retrieval-baseline.md) |
| Refresh README media | [Capture provenance and instructions](../screenshots/CAPTURE.md) |
| See the findings addressed in this documentation review | [Documentation review](documentation-review.md) |

## Plans and historical evidence

Plans mix completed milestones with future work; use the guides above for current behavior. Results and evidence are dated receipts, not statements that the current build has passed every manual acceptance gate.

- Desktop: [Windows plan](windows-desktop-plan.md), [M0](windows-m0-results.md), [M1](windows-m1-results.md), [M2](windows-m2-results.md), [M3](windows-m3-results.md), [M4](windows-m4-results.md); [Linux plan](linux-desktop-plan.md), [results](linux-desktop-results.md) and [shared app-menu implementation/evidence](linux-menu-plan.md).
- Desktop integration: [ChatGPT plan](windows-chatgpt-plan.md) and [results](windows-chatgpt-results.md); [CLI/skill plan](windows-cli-skill-plan.md).
- Reader: [beta and retrieval plan](reader-beta-and-retrieval-plan.md), [retrieval baseline](retrieval-baseline.md).
- Kindle: [original companion plan](kindle-browser-extension-plan.md), [first-class book tasks](extension-first-class-tasks.md).
- Future work: [multi-format sources](multi-format-sources-spec.md), [mobile plan](mobile-plan.md).
- Verification receipts: [Windows shell](evidence/windows-shell.md), [collections](evidence/windows-collections.md), [CLI](evidence/windows-cli.md), [Firebase alpha](evidence/firebase-desktop-alpha.md), [recovery and diagnostics](evidence/recovery-and-diagnostics.md).
