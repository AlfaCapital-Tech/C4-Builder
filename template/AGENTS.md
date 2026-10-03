# AGENTS.md

Architecture documentation built with [c4builder](https://github.com/AlfaCapital-Tech/C4-Builder):
C4 diagrams (PlantUML, D2) and markdown in `src/` are compiled into `docs/`.

## Commands

```bash
c4builder                    # build docs/ (non-interactive with a complete .c4builder)
c4builder check <file...>    # validate .puml / .iuml / .d2 files, exit code 0 = OK
c4builder --site -w          # live preview on http://localhost:3000 - never exits
```

Not installed: `npm i -g @alfacapital-tech/c4builder` (Node.js 22.17+; Java 17+ is used
when present, otherwise c4builder downloads a private JRE).

## Workflow

1. Edit files in `src/` only — `docs/` is generated and wiped on every build.
2. Run `c4builder check` on every diagram you changed, `src/styles.iuml` included. Errors
   look like `✗ <file>: line <N>: <message>`. Fix until the exit code is 0.
3. Run `c4builder` and make sure it exits with code 0. Leave `c4builder --site -w` to a
   human or run it in the background.

## Layout

- One folder = one page. All `.md` files of a folder form its text; every `.puml` / `.d2`
  in it is rendered onto the page, or placed inline with `![title](diagram.puml)`.
- Files and folders starting with `_` are not published (shared libraries, drafts).
- `.c4builder` is the config (JSON); unknown keys are silently ignored.

## Diagram conventions

- C4 comes from the PlantUML stdlib — `!include <C4/C4_Context>` (`C4_Container`,
  `C4_Component`, `C4_Dynamic`, `C4_Deployment`). It is bundled, rendering is offline;
  never include C4 by URL.
- Shared styles live in `src/styles.iuml`, included after the C4 include by a relative
  path: `!include styles.iuml` in `src/`, `!include ../styles.iuml` one level down.
- D2 diagrams share classes through `src/_c4lib.d2` (`...@../_c4lib`).

## Agent skills

Detailed guidance (project layout, config keys, plugins, installation) as skills for
Claude Code, Codex, Cursor and other agents:

```bash
npx skills add AlfaCapital-Tech/C4-Builder/skills
```
