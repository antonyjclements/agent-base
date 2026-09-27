export const USAGE = `Usage: moonbase1 [command] [options]

Commands:
  (none), start     Start Moon Base and open the page
  doctor            Say what start would decide, and whether each live source is reporting
  install-hooks     Add Moon Base's live-status hooks to Claude Code and/or Codex
  uninstall-hooks   Remove exactly what install-hooks added
  hooks-status      Show what is installed, and whether events are arriving

Start options:
  --no-open         Do not open the page
  --port <n>        Start looking for a free port at n (default 5274, or PORT)
  -h, --help        Show this help

Inside a cmux terminal the terminal launcher is turned on for you. Set MOON_BASE_TERMINAL to decide it
yourself. To get this command on your PATH, run \`npm link\` once in the Moon Base folder.`
