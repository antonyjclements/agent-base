---
title: Quote the heredoc delimiter when the body contains backticks or dollar signs
scope: repo
created: 2026-09-26
trigger: correction
status: tentative
evidence-count: 1
unconfirmed-runs: 0
derived-from:
  - 2026-09-26-moon-base-fork-build
tags:
  - shell
  - process
---

# Quote the heredoc delimiter when the body contains backticks or dollar signs

## Lesson

In a shell heredoc with an unquoted delimiter (`<<EOF`), the shell expands `$variables` and runs anything in backticks before the program sees the text. A Python script embedding Markdown-style comments with backticked file names had each backticked name executed as a command, and the text that reached Python was missing those names.

## Applies When

- Passing a script or a block of prose through a heredoc from a shell tool.
- The body contains backticks, `$`, or backslashes, as code comments and Markdown do.

## Do Instead

- Use a quoted delimiter (`<<'EOF'`), which passes the body through untouched.
- For larger files, write them with the file-writing tool instead of a heredoc.
- After a scripted edit, read the result back rather than trusting that the replacement text arrived intact.

## Evidence

- Happened while adapting a build script in the Moon Base build. Every executed name failed harmlessly, but a header comment was left with gaps and one planned edit was skipped.
