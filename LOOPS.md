# Project loops

## Local test-quality pass

Improves test confidence by completing at most one high-value test or bug-fix improvement per manual run.

Prompt:
> Review the current code, coverage, test results, and reproducible user-visible bugs. Choose at most one highest-risk uncovered behavior or bug. If none offers measurable value, make no changes and report a clean no-op. Add a meaningful regression test; if it exposes a bug, fix the smallest root cause. Run the affected checks and `npm run typecheck`, `npm test`, and `npm run build`; also run `npm run test:e2e` for frontend changes. Keep only verified changes, never weaken assertions or coverage thresholds, preserve unrelated work, and do not commit or push. Stop after the single improvement or earlier if blocked. Report coverage changes, tests, fixes, evidence, and remaining gaps.

- Saved: 2026-07-14
- Sources:
  - https://signals.forwardfuture.com/loop-library/loops/quality-streak-loop/
  - https://signals.forwardfuture.com/loop-library/loops/100-percent-test-coverage-loop/
- Sources modified: 2026-06-17
