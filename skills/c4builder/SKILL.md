---
name: c4builder
description: Work on a c4builder architecture-docs project - C4 model diagrams in PlantUML (C4-PlantUML stdlib) or D2 plus markdown, built into a docsify site or markdown files. Use when creating or editing .puml, .iuml, .d2 or .md files in a project that has a .c4builder config, when changing .c4builder settings or plugins (openspec, openapi), or when building, validating or previewing the docs. Teaches the edit, c4builder check, build loop and the C4-PlantUML conventions.
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
- Every `.puml` / `.d2` in a folder is rendered and attached to the page (on top by
  default, `diagramsOnTop`), unless the markdown places it explicitly with
  `![name](container.puml)` — then it appears exactly there.
- Files and folders starting with `_` are skipped (use it for shared libraries and drafts);
  `CLAUDE.md` is skipped too. Other files (images, `.iuml`) are copied next to the page —
  keep their names unique across the project.
- `foo.puml` and `foo.d2` in one folder render to the same image name → build error.
- Never edit `docs/` (or whatever `distFolder` is): every build regenerates it.

## The loop: edit → check → build

1. **Edit** markdown and diagrams under `src/`.
2. **Check every diagram you changed** — fast, no project build, writes nothing:

   ```bash
   c4builder check src/context.puml "src/1 Internet Banking System/system.puml"
   ```

   Exit code 0 means every file compiles. Otherwise each broken file is reported as
   `✗ <file>: строка <N>: <message>` (`строка` means "line"; PlantUML lines count from the
   top of the file). Errors in a `.iuml` carry no line number; D2 errors end with
   `<file>:<line>:<col>: <message>`. Fix and re-run until the exit code is 0. After changing
   a `.iuml`, check the `.puml` files that include it: a `.iuml` alone is checked inside an
   empty diagram, so a styles file calling C4 macros (`UpdateElementStyle`) fails on its
   own. Same engines as the build (bundled PlantUML jar, bundled D2), no `.c4builder` needed.
3. **Build** the whole project:

   ```bash
   c4builder
   ```

   With a complete `.c4builder` (written by `c4builder --new --name <name> -y` or by the
   first interactive run) this is a one-off, non-interactive build. A missing or partial
   config starts an interactive wizard — do not drive it, ask the user or write the full
   config (references/config.md). A diagram that fails here aborts the build with a long
   Java stack trace and keeps the previous output in `docs_bk/`; run `c4builder check` on
   the changed files to get the short message.
4. **Look at the result** in `docs/`: `docs/<folder>/README.md` (markdown collection),
   `docs/index.html` + `docs/<folder>/<folder>.md` (site), `docs/<folder>/<diagram>.svg`.
5. **Live preview for a human:** `c4builder --site -w` builds, serves on
   `http://localhost:3000` (`webPort`, or `-p <n>`), rebuilds on save and reloads the
   browser; `-o` opens it. It never exits — start it in the background or leave it to the
   user. `c4builder site` builds and serves without watching (also never exits).

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

## Config and plugins

- Read [references/config.md](references/config.md) before editing `.c4builder`: unknown
  keys are **silently dropped**, so a typo does nothing. `c4builder --list` prints the
  current config.
- Read [references/plugins.md](references/plugins.md) when the project has or needs
  `plugins` — `openspec` (OpenSpec store as a site section) or `openapi` (swagger-ui pages).

## Common mistakes

- Editing generated files in `docs/` instead of `src/`.
- Remote `!include` URLs instead of `<C4/...>` stdlib includes.
- Running `c4builder --site -w` in the foreground — the agent hangs.
- Forgetting `c4builder check` and reading a Java stack trace from the full build instead.
- A page "missing" from the output because its file or folder starts with `_`.
- `generateLocalImages: false` in a project with `.d2` files — D2 has no online renderer,
  the build stops with an error.
