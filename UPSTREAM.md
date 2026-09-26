# Upstream

Moon Base is based on [Bot Crossing](https://github.com/Station-Sciences/bot-crossing), an MIT-licensed project by Jarren Rocks. It is not endorsed or maintained by that project.

## What was imported

- Source: https://github.com/Station-Sciences/bot-crossing
- Commit: `d05ac2ffad9fce3d68e29ab446fce99b7123847b` (2026-09-18, "Two more places that still said astronaut")
- License: MIT. The upstream copyright notice is kept in `LICENSE` and Moon Base's own line is added beneath it.

## What was kept

`server/` (scanner, API, and the Claude Code and Codex adapters), `src/`, `test/`, `tools/` (build and check tooling), `vite.config.js`, `index.html`, `package.json` and `package-lock.json`.

## What was left out, and why

- The other adapters (Antigravity, Cursor, Hermes, Kilo Code, OpenCode): Moon Base supports Claude Code and Codex only.
- Upstream's `server/lib/terminal.mjs` and `server/lib/win-terminal.mjs`: its terminal launchers, which built command lines from request data. Moon Base opens sessions through the tools' URL schemes by default. It later added its own, much smaller terminal hand-off (a copied command and an opt-in cmux launcher, see `docs/decisions/2026-09-26-terminal-handoff-copy-command-and-opt-in-launcher.md`). That code is new and written for Moon Base; it reuses only the file name `server/lib/terminal.mjs`, and nothing from upstream's launchers was carried over.
- `public/assets/` (built models), `design/`, and `tools/build-crew.mjs`, `tools/bot-showcase.*`, `tools/face-sheet.*`: these carry upstream's crew character, whose design upstream reserves. Moon Base builds its own art from CC0 packs.
- `tools/build-bot.mjs` is the one exception in that group: it is adapted from upstream's `tools/build-crew.mjs` (MIT), because all it does is combine two CC0 files by Kay Lousberg into one rigged model. It writes `bot.glb`, and the bot's look is decided in Moon Base's own code.
- `TRADEMARKS.md`, `DECISIONS.md`, `CONTRIBUTING.md`, `README.md`, `.claude/`: upstream's own project documents and per-machine settings.

## Following upstream

There is no automatic sync. To take a later upstream change, diff the upstream commit range and cherry-pick by hand, then update the commit recorded above.
