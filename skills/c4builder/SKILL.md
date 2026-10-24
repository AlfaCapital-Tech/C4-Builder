---
name: c4builder
description: Work on a c4builder architecture-docs project - C4 model diagrams in PlantUML (C4-PlantUML stdlib) or D2, BPMN process diagrams, Mermaid diagrams, Wireflow user flows, plus markdown, built into a docsify site or markdown files. Use when creating or editing .puml, .iuml, .d2, .bpmn, .mmd, .wireflow.json or .md files in a project that has a .c4builder config, when changing .c4builder settings or plugins (openspec, openapi, figma), or when building, validating or previewing the docs. Teaches the edit, c4builder check, build loop and the C4-PlantUML conventions.
---

# c4builder

c4builder compiles a folder tree of markdown and diagrams into documentation: a docsify
site, a collection of markdown files with navigation and/or one complete markdown file.
Installing or repairing the CLI itself is the `c4builder-setup` skill.

A c4builder project is a folder with a `.c4builder` file (JSON config) next to the source
folder (`rootFolder`, `src` by default).

## Project layout

```text
.c4builder              config (JSON)            -> references/config.md
.c4builder.cache        render checksums         (git-ignored)
src/                    rootFolder: one folder = one page
  context.md            page text
  context.puml          diagram attached to the same page
  styles.iuml           shared PlantUML styles, included by diagrams
  _c4lib.d2             "_" prefix: never rendered or published, still includable
  1 Internet Banking System/
    system.md
    system.puml
    API Application/
      container.md
      container.puml
docs/                   distFolder: generated, wiped on every build
```

How the source tree becomes pages:

- Every folder is one page and one node in the navigation; the page title is the folder
  name (the root page is `homepageName`). Siblings are sorted by name — prefix folders with
  numbers (`1 …`, `2 …`) to order them.
- All `.md` files of a folder are concatenated into its page.
- Every `.puml` / `.d2` / `.bpmn` / `.mmd` / `.wireflow.json` in a folder is rendered and attached to the page (on top by
  default, `diagramsOnTop`), unless the markdown places it explicitly with
  `![name](container.puml)` — then it appears exactly there.
- Files and folders starting with `_` are skipped (use it for shared libraries and drafts);
  `CLAUDE.md` is skipped too. Other files (images, `.iuml`) are copied next to the page —
  keep their names unique across the project.
- `foo.puml`, `foo.d2`, `foo.bpmn`, `foo.mmd` and `foo.wireflow.json` in one folder render to the same image name → build error.
- Never edit `docs/` (or whatever `distFolder` is): every build regenerates it.

## The loop: edit → check → build

1. **Edit** markdown and diagrams under `src/`.
2. **Check every diagram you changed** — fast, no project build, writes nothing:

   ```bash
   c4builder check src/context.puml "src/1 Internet Banking System/system.puml"
   ```

   Exit code 0 means every file compiles. Otherwise each broken file is reported as
   `✗ <file>: line <N>: <message>` (PlantUML lines count from the top of the file). Errors
   in a `.iuml` carry no line number; D2 errors end with `<file>:<line>:<col>: <message>`;
   BPMN problems are `✗ <file>: <element id> [<rule>] <description>`, one line each;
   mermaid errors are `✗ <file>: line <N>: <message>`; wireflow problems are
   `✗ <file>: <problem>` with the node or edge id, one line each.
   Fix and re-run until the exit code is 0. A changed `.iuml` is checked directly too: a
   styles file calling C4 macros (`UpdateElementStyle`) is checked with the C4 stdlib
   included. Same engines as the build (bundled PlantUML jar, bundled D2, BPMN pipeline, mermaid, wireflow), no
   `.c4builder` needed.
3. **Build** the whole project:

   ```bash
   c4builder
   ```

   With a complete `.c4builder` (written by `c4builder --new --name <name> -y` or by the
   first interactive run) this is a one-off, non-interactive build. A missing or partial
   config needs the interactive wizard; without a terminal the run stops with exit code 1.
   Do not drive the wizard: ask the user or write the full config (references/config.md). A diagram that fails here aborts the build with a long
   Java stack trace and keeps the previous output in `docs_bk/`; run `c4builder check` on
   the changed files to get the short message.
4. **Look at the result** in `docs/`: `docs/<folder>/README.md` (markdown collection),
   `docs/index.html` + `docs/<folder>/<folder>.md` (site), `docs/<folder>/<diagram>.svg`.
5. **Live preview for a human:** `c4builder --site -w` builds, serves on
   `http://localhost:3000` (`webPort`, or `-p <n>`), rebuilds on save and reloads the
   browser; `-o` opens it, `-o <change-id>` opens the OpenSpec change page by its short
   address `#/change/<change-id>` (a warning on stderr when the site has no such change). It
   never exits — start it in the background or leave it to the user. The server comes up right
   after `serving your docsify site` (and `-o` opens the browser then), before the diagrams are
   rendered: on a cold cache they show a `rendering…` placeholder and are drawn in the
   background (`rendering N diagrams in background…` → `rendered N diagrams in T s`), the page
   open in the browser first; a render error shows an error placeholder and `✗` in the log,
   the server stays up. Its output is for viewing, not for publishing — run `c4builder` for
   that. `c4builder site` builds and serves without watching (also never exits). In `-w` a
   human can select text on a page and add a question: it lands in the source `.md` under the
   `questionsHeading` section (`Open questions` by default) — read it there, not in `docs/`.
   `C4BUILDER_RENDER_CONCURRENCY=<n>` sets the number of parallel PlantUML processes (default
   `min(4, CPU − 1)`); the output does not depend on it.

## Feedback from the page

When the user wants to look at the pages and tell you what to fix, use the `c4builder-review`
skill (`/c4builder-review [change-id|page]`): it checks the server, gives the link to the page and
runs the batch loop.

In short: under an agent (`CLAUDECODE`, `CODEX_THREAD_ID`, `GEMINI_CLI`, `OPENCODE`, `COPILOT_CLI`,
`AI_AGENT`, or `--agent`) `c4builder --site -w` adds a **Feedback** button to text selected on a
page. The comments do not go into the files: `c4builder feedback --wait --as <name>`, run in the
background with your change or task as `<name>`, exits with one batch on stdout. When `<name>` is an
OpenSpec change of the site, it first prints `Change page: http://localhost:<port>/#/change/<name>`
on stderr — the link to give the human. Apply the batch to the sources, run the command again with
the same name and stop on `Decision: approved`.

## Writing C4 diagrams (PlantUML)

```plantuml
@startuml
!include <C4/C4_Container>
!include ../styles.iuml

Person(user, "Customer", "Uses the web app")
System_Boundary(shop, "Shop") {
    Container(web, "Web App", "TypeScript", "Catalog and checkout")
    ContainerDb(db, "Database", "PostgreSQL", "Orders")
}
Rel(user, web, "Uses", "HTTPS")
Rel(web, db, "Reads/writes", "SQL")
@enduml
```

- Include C4 from the PlantUML stdlib: `!include <C4/C4_Context>`, `<C4/C4_Container>`,
  `<C4/C4_Component>`, `<C4/C4_Dynamic>`, `<C4/C4_Deployment>`. It is bundled in the jar —
  builds work offline. Never `!include https://…` (network on every build, breaks CI).
- Shared look lives in one `.iuml` (the template's `src/styles.iuml`), included **after**
  the C4 include by a path relative to the diagram: `!include styles.iuml` from `src/`,
  `!include ../styles.iuml` one level down.
- One diagram per file, `@startuml` … `@enduml`, file name = image name.
- Non-Latin text (Cyrillic etc.) works: sources are UTF-8, the bundled font covers it.

Details — sequence/class diagrams, D2, fonts, PNG output: read
[references/diagrams.md](references/diagrams.md) when writing anything beyond a plain
C4-PlantUML diagram.

## Business processes (BPMN)

A `.bpmn` file is BPMN 2.0 XML with **only the semantic model** — no `bpmndi` coordinates:
the build validates the model and lays it out with horizontal pools and lanes. Read
[references/bpmn.md](references/bpmn.md) before creating or editing any `.bpmn` file: source
format, pool/lane conventions and how to fix every `c4builder check` message.

## Mermaid

`.mmd` files and ```` ```mermaid ```` blocks in pages and OpenSpec artifacts are rendered at
build time into images (real mermaid, no browser). Use them for flows, sequences, states and
ER inside the docs; keep the C4 model in PlantUML. Read
[references/mermaid.md](references/mermaid.md) before writing mermaid: supported types,
fixed config keys and the `c4builder check` loop.

## Wireflow

`*.wireflow.json` (or `wireflow.json`) — an export of the Wireflow user-flow editor: screen
cards, notes, groups and transitions — is rendered at build time into an image (own renderer,
bundled screen templates, no browser). Read [references/wireflow.md](references/wireflow.md)
before adding or editing one: file names, structure, format versions and `c4builder check`
messages.

## Config and plugins

- Read [references/config.md](references/config.md) before editing `.c4builder`: unknown
  keys are **silently dropped**, so a typo does nothing. `c4builder --list` prints the
  current config.
- Read [references/plugins.md](references/plugins.md) when the project has or needs
  `plugins` — `openspec` (OpenSpec store as a site section), `openapi` (swagger-ui and AsyncAPI pages) or
  `figma` (Figma frame embeds).

## Reading an existing architecture

With `generateLLMS: true` the built site has `llms.txt` (every page in sidebar order, links
to its `.md`) and `llms-full.txt` (all pages in one file, diagrams inlined as PlantUML/D2/BPMN/Mermaid/Wireflow
source, shared local includes once in an appendix). To answer questions about a documented
system, read `llms-full.txt` from the site or `distFolder` instead of crawling pages or
images: the C4 source (`Person`, `System`, `Rel`) is the model itself.

## New version notice

When c4builder output ends with a stderr line

```text
c4builder <new> is available (current <current>). Run: c4builder update
```

a newer c4builder is published. Tell the user. Run `c4builder update` only when the user asks
for it: it reinstalls the global CLI. The notice changes neither stdout nor the exit code.

## Skills notice

When a build or `c4builder site` run by an agent starts with one of these stderr lines

```text
c4builder agent skills are not installed here. Ask the user, then run: c4builder skills
c4builder agent skills here are from <stamp> (current <version>). Ask the user, then run: c4builder skills
~/.claude/skills/c4builder (<stamp|no version>) overrides project skills. Ask the user to remove it, then run: c4builder skills
```

the c4builder skills you work with are missing, older than the CLI, or shadowed by a stale personal
copy (`~/.agents/skills/c4builder` for agents other than Claude Code). Tell the user. Run
`c4builder skills` only when the user agrees: it writes the skills of the installed CLI into
`.agents/skills/` of the current folder (and `.claude/skills/` under Claude Code), replacing the
c4builder skills there. Remove a personal copy only when the user agrees. The notice changes
neither stdout nor the exit code.

## Common mistakes

- Editing generated files in `docs/` instead of `src/`.
- Remote `!include` URLs instead of `<C4/...>` stdlib includes.
- Running `c4builder --site -w` or `c4builder feedback --wait --as <name>` in the foreground — the
  agent hangs.
- Forgetting `c4builder check` and reading a Java stack trace from the full build instead.
- A page "missing" from the output because its file or folder starts with `_`.
- `generateLocalImages: false` in a project with `.d2`, `.bpmn`, `.mmd` or `.wireflow.json` files — they have no online
  renderer, the build stops with an error.
- Writing `bpmndi` coordinates into a `.bpmn` — they are ignored; the layout is always automatic.
