# Project loops

## Test stabilizer

Checks the primary test suite for inconsistent results, repairs one proven root cause at a time, and stops after three consecutive passes or a bounded terminal state.

Prompt:
> Run `npm test` three times under the same conditions and list tests whose result changes. If all three pass, stop without changes. Otherwise, fix the most frequent flake at its root cause—shared state, timing, ordering, or an external dependency—never with a blind sleep or retry. Run the affected test three times, then rerun the full suite. Repeat until three consecutive full-suite runs pass, progress stalls, or approval is required. Preserve unrelated work, exclude `npm run test:e2e`, and return each flake, cause, fix, evidence, and justified quarantine.

- Saved: 2026-07-14
- Source: https://signals.forwardfuture.com/loop-library/loops/test-stabilizer-loop/
- Source modified: 2026-06-20
