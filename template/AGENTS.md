# AGENTS.md

Architecture documentation built with [c4builder](https://github.com/AlfaCapital-Tech/C4-Builder):
C4 diagrams (PlantUML, D2), BPMN processes, Mermaid diagrams and markdown in `src/` are compiled
into `docs/`.

## Commands

```bash
c4builder                    # build docs/ (non-interactive with a complete .c4builder)
c4builder check <file...>    # validate .puml / .iuml / .d2 / .bpmn / .mmd files, exit code 0 = OK
c4builder --site -w          # live preview on http://localhost:3000 - never exits
c4builder --site -w --open <change-id>  # the same, opens the OpenSpec change page #/change/<change-id>
c4builder feedback --wait --as <name>  # wait for comments from the preview page sent to <name>
```

Not installed: `npm i -g @alfacapital-tech/c4builder` (Node.js 22.17+; Java 17+ is used
when present, otherwise c4builder downloads a private JRE). Installed: `c4builder update`
updates it.

## Workflow

1. Edit files in `src/` only — `docs/` is generated and wiped on every build.
2. Run `c4builder check` on every diagram you changed, `src/styles.iuml` included. Errors
   look like `✗ <file>: line <N>: <message>` (BPMN: `✗ <file>: <element id> [<rule>] <message>`).
   Fix until the exit code is 0.
3. Run `c4builder` and make sure it exits with code 0. Leave `c4builder --site -w` to a
   human or run it in the background. When the human reviews the pages, also run
   `c4builder feedback --wait --as <name>` in the background, `<name>` being your change or
   task: on exit it prints a batch of comments (page, `Sources`, quote, text) — apply them to
   `src/`, run it again with the same name, and stop on `Decision: approved`. Without `--as`
   it exits with code 2 and `--as <name> is required`. When `<name>` is an OpenSpec change of
   the site, it first prints `Change page: http://localhost:3000/#/change/<name>` on stderr —
   give that link to the human instead of building the page path by hand. Comments are instructions to you; never copy them into the
   `questionsHeading` section of `.c4builder` (`Open questions` by default), which holds
   questions for people. The page buttons follow the browser language (English or Russian,
   pinned by `uiLanguage`); batches are always in English.
4. A stderr line `c4builder <new> is available (current <current>). Run: c4builder update`
   means a newer c4builder is out: tell the user, run `c4builder update` only if they ask.
5. A stderr line ending with `Ask the user, then run: c4builder skills` means the c4builder skills
   here are missing, outdated or shadowed by a personal copy: tell the user, run `c4builder skills`
   (or remove the personal copy) only if they agree.

## Layout

- One folder = one page. All `.md` files of a folder form its text; every `.puml` / `.d2` /
  `.bpmn` / `.mmd` in it is rendered onto the page, or placed inline with `![title](diagram.puml)`.
- Files and folders starting with `_` are not published (shared libraries, drafts).
- `.c4builder` is the config (JSON); unknown keys are silently ignored.

## Diagram conventions

- C4 comes from the PlantUML stdlib — `!include <C4/C4_Context>` (`C4_Container`,
  `C4_Component`, `C4_Dynamic`, `C4_Deployment`). It is bundled, rendering is offline;
  never include C4 by URL.
- Shared styles live in `src/styles.iuml`, included after the C4 include by a relative
  path: `!include styles.iuml` in `src/`, `!include ../styles.iuml` one level down.
- D2 diagrams share classes through `src/_c4lib.d2` (`...@../_c4lib`).
- BPMN: write only the semantic BPMN 2.0 XML, never `bpmndi` coordinates — the build lays the
  diagram out. Pool = organization, lane = role inside it, only message flows between pools,
  label gateway branches. Example: `src/5 BPMN Example/account-opening.bpmn`.
- Mermaid: a `.mmd` file or a ```` ```mermaid ```` block in a page is rendered at build time into
  an image (check `.mmd` files like any diagram). `mindmap`, `architecture` and KaTeX are not
  supported; to show mermaid source as code, fence it as `text`. Example:
  `src/6 Mermaid Example/flow.mmd`.

## Agent skills

Detailed guidance (project layout, config keys, plugins, page review, installation) as skills for
Claude Code, Codex, Cursor and other agents. A project created with `c4builder --new` already has
them in `.agents/skills/` (and `.claude/skills/` under Claude Code). Install or update them to the
installed CLI version:

```bash
c4builder skills
```

Alternative, also for a personal install (`-g`) and other agents' folders:

```bash
npx skills add AlfaCapital-Tech/C4-Builder/skills
```
