# Diagrams

The engine is chosen by file extension: `.puml` is rendered by PlantUML, `.d2` by D2. Both
formats can live in one project and even in one folder, as long as the file names differ.

## PlantUML

c4builder runs the bundled PlantUML jar directly with `java`; layout is computed by the built-in
Smetana engine. There is no Graphviz to install. The jar version is pinned in the package, so
updating PlantUML on a developer machine does not change the build.

**C4 without internet.** The C4-PlantUML library is built into the jar; include it through the
stdlib:

```puml
@startuml
!include <C4/C4_Container>
!include ../styles.iuml

Person(user, "Customer")
System(bank, "Internet banking")
Rel(user, bank, "Uses", "HTTPS")
@enduml
```

**Shared styles** go into an `.iuml`: `skinparam`, `UpdateElementStyle(...)`, your own macros.
Include it after the C4 include with a relative path. Paths in `!include` are relative to the
diagram's folder, not to the project root.

**Cyrillic** works in labels, descriptions and folder names: the diagram font contains it.

**ditaa** (`@startditaa`) is supported too and is always rendered as PNG.

## Diagrams inside a page

A ```` ```plantuml ```` block in an `.md` page is rendered at build time just like a `.puml`
file: the site, the markdown collection and the complete document get an image in its place,
not the block text. `@startuml`/`@enduml` may be omitted, `!include` paths are relative to the
page's folder. A broken block does not fail the build: the image is replaced by a placeholder
and the log shows a warning with the `.md` file path.

To show diagram source as code, mark the block `puml` or `text`: such blocks stay code, and
so do ```` ```d2 ```` blocks.

## Determinism and the font

Diagrams are drawn with the bundled Nimbus Sans font (Helvetica metrics, Cyrillic, Greek) rather
than a system font. The same diagram therefore has identical geometry on macOS, Linux, in CI and
in Docker, and the SVG diff in a pull request shows only real changes.

`useSystemFonts: true` in `.c4builder` (or `--system-fonts` for one run) switches to system
fonts. The look becomes more familiar, but the result depends on the machine.

## Render cache

Unchanged diagrams are not rendered again: c4builder keeps checksums in `.c4builder.cache`. A
checksum covers the source, all local `!include`s and D2 imports, the output path and the render
settings. Editing a shared `styles.iuml` re-renders every diagram that includes it, and only
those.

## D2

[D2](https://d2lang.com) is rendered by the WASM build of the engine right inside Node — no
external binaries. A markdown reference looks the same as for PlantUML: `![overview](landscape.d2)`.

- The engine is an optional dependency, `@terrastruct/d2` (~60 MB). npm installs it together with
  c4builder, and it is loaded only when the project contains a `.d2`. If the package is missing
  (for example, installed with `--omit=optional`), the build stops with the hint
  `npm install @terrastruct/d2`.
- [Imports](https://d2lang.com/tour/imports) `@file` and `...@file` are resolved by c4builder
  itself, no network needed. Prefix a shared class library with `_` (`_c4lib.d2`) so it is not
  rendered as a diagram of its own: `...@../_c4lib`.
- Layout is set by the `d2Layout` key: `dagre` (default) or `elk`.

## PNG

With `diagramFormat: png`, c4builder renders SVG and rasterizes it with
[resvg](https://github.com/thx/resvg-js) using the same bundled font. The PNG is consistent for
PlantUML and D2 and needs no browser. ditaa stays a native PlantUML PNG.

## Online PlantUML server

With `generateLocalImages: false`, diagrams are not rendered locally: the output links to the
server from `plantumlServerUrl` (default `https://www.plantuml.com/plantuml`). This means diagram
sources go to an external server, and D2 does not work in this mode — the build stops with an
error. The mode is kept for compatibility; local rendering is the main one.

## Checking individual diagrams

```bash
c4builder check src/context.puml "src/4 D2 Example/landscape.d2"
```

`check` validates `.puml`, `.iuml` and `.d2` files with the same engine as the build, but writes
nothing and needs no project or `.c4builder`. Exit code 0 means every file compiles, 1 means
there is an error (messages are printed in Russian for now; `строка` means "line"):

```text
✓ src/context.puml
✗ src/system.puml: строка 4: Fatal parsing error
```

`!include` is resolved from the folder of the checked file. An `.iuml` library is checked by
including it into an empty diagram — without the C4 include. So an `.iuml` that uses C4 macros
(`UpdateElementStyle` and the like) does not pass on its own: check the diagrams that include it.

A pre-commit hook that checks staged diagrams (`.git/hooks/pre-commit`; spaces in paths are
fine):

```bash
#!/bin/sh
git diff --cached --name-only -z --diff-filter=ACM -- '*.puml' '*.d2' | xargs -0 -r c4builder check
```
