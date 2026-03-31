---
title: Asynchronous web research completion notifications
type: change
authors:
  - mavam
  - codex
created: 2026-03-31T06:02:50.86872Z
---

The `web_research` tool now starts long-running research asynchronously instead of blocking the current turn until the final report is ready.

While research is running, pi shows a small persistent widget above the editor listing the active research jobs. When research completes, pi posts a completion message with the saved report path, and the full report is always written to a file under `.pi/artifacts/research/` in the active project. This keeps interactive sessions responsive while still preserving the complete research output for later review.
