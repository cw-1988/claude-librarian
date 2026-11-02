# claude-librarian

Rules and a Stop hook that keep a project's docs and Claude memory cheap to load as they grow.

Claude Code loads `CLAUDE.md`, `AGENTS.md` and `MEMORY.md` into every session and then reads whatever they point at.
Left alone, those files grow into long walls of detail, and every session pays for them. These rules keep them as
slim indexes: one topic per file, hubs with one line per linked file, hubs split into sub-hubs once they get long.
Claude follows such rules for a while and then drifts. The hook checks them every time Claude finishes a turn.

Zero dependencies, Node 22 or later (or Bun), reads only local files.

## What's in it

- **[RULES.md](RULES.md)**: the rules, written for Claude. Import them into your `CLAUDE.md` or copy them in.
- **`src/docs-check.mjs`**: the check. It reads every `.md` in the project and in the project's Claude memory folder
  (`~/.claude/projects/<project>/memory`) and flags:
  - **Broken links**: a relative link to a missing file, an anchor that matches no heading, a `[[name]]` with no file.
  - **Hub too big**: more than 15 link lines (list items or table rows linking a local file or a memory).
  - **Topic file too big**: over 25,000 characters.
  - **Upfront file too big**: `CLAUDE.md`, `AGENTS.md` or `MEMORY.md` over 5,000 characters.
  - **Not linked from any hub**: a doc or memory nothing links to (READMEs, CLAUDE.md, AGENTS.md and MEMORY.md are
    entry points and exempt).
  - **MEMORY.md**: a line that doesn't link a hub (a memory with at least 3 `[[...]]` links).

## Install

```bash
git clone https://github.com/cw-1988/claude-librarian ~/claude-librarian
cd your-project
node ~/claude-librarian/src/docs-check.mjs
```

That prints every problem and the count. Fix the existing ones first (or ask Claude to), then add the rules and the
hook.

Rules: add this line to the project's `CLAUDE.md` (Claude Code imports the file), or paste the bullets in:

```
@~/claude-librarian/RULES.md
```

Hook: add it to the project's `.claude/settings.json`, using your own path:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"/home/you/claude-librarian/src/docs-check.mjs\" --hook", "timeout": 120 }
        ]
      }
    ]
  }
}
```

With problems it blocks the stop once and hands Claude the list to fix. If they are still there on the next stop
(`stop_hook_active`), it only shows them, so a session never loops. With none it is silent. If the check itself fails,
it lets the stop through.

## Config

Optional, in `.claude/docs-check.json` in the project. Every key falls back to its default. See
[examples/docs-check.json](examples/docs-check.json).

| Key | Default | What |
|-----|---------|------|
| `roots` | `["."]` | folders searched for `.md` files |
| `files` | `[]` | single files added on top |
| `exclude` | `node_modules`, `.git`, `.claude`, `vendor`, `dist`, `build`, `Library` | regexes on the path relative to the project, `/` separated; folders end in `/` |
| `entryPoints` | `^(README\|CLAUDE\|AGENTS\|MEMORY)\.md$` | file names that need no link to them |
| `notOrphan` | `[]` | path regexes that need no link either |
| `upfront` | `^(CLAUDE\|AGENTS\|MEMORY)\.md$` | file names loaded at session start |
| `hubLinkLines` | `15` | link lines before a hub must split |
| `topicChars` | `25000` | characters before a topic file must split |
| `upfrontChars` | `5000` | characters for each upfront file |
| `memory` | `true` | also check the project's Claude memory folder |
| `checks` | `[]` | extra check modules, paths relative to the project |

**Extra checks** are for rules only your project has. A module's default export gets
`{ projectDir, memoryDir, files, memFiles, read }` and returns a list of problem strings (or a promise of one). See
[examples/extra-check.mjs](examples/extra-check.mjs).

`CLAUDE_CONFIG_DIR` is respected when finding the memory folder; in the hook it comes from the transcript path.

## License

MIT
