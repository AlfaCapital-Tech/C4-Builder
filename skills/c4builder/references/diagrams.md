# Diagrams reference

The backend is chosen by file extension: `.puml` → PlantUML, `.d2` → D2, `.bpmn` → BPMN
(validation + automatic layout + bpmn-js, see [bpmn.md](bpmn.md)). All of them can live in one
project and one folder (with different base names).

## PlantUML and C4-PlantUML

Rendering is offline: the PlantUML jar is bundled and runs on Java 17+ with the built-in
Smetana layout — Graphviz is not used. `!pragma layout elk` needs Java 21.

**C4 includes** come from the PlantUML stdlib (C4-PlantUML is inside the jar):

| Level | Include | Main macros |
|---|---|---|
| System context | `!include <C4/C4_Context>` | `Person`, `System`, `System_Ext`, `Rel` |
| Container | `!include <C4/C4_Container>` | `Container`, `ContainerDb`, `ContainerQueue`, `System_Boundary` |
| Component | `!include <C4/C4_Component>` | `Component`, `ComponentDb`, `Container_Boundary` |
| Dynamic | `!include <C4/C4_Dynamic>` | numbered `Rel` steps |
| Deployment | `!include <C4/C4_Deployment>` | `Deployment_Node`, `Node` |

Each level includes the previous ones. `LAYOUT_WITH_LEGEND()`, `LAYOUT_TOP_DOWN()`,
`LAYOUT_LEFT_RIGHT()` control layout and legend. Do not include C4 by URL
(`!include https://…`, `!includeurl`): it needs network on every build and pins nothing.

**Shared styles** — one `.iuml` library included after the C4 include, by a path relative
to the including diagram:

```plantuml
@startuml
!include <C4/C4_Context>
!include ../styles.iuml
...
@enduml
```

Put `skinparam`s and `UpdateElementStyle(...)` / `AddElementTag(...)` calls there. A `.iuml`
is never rendered on its own; it is copied to the output like any other file (prefix it
with `_` to keep it out). Editing an included file re-renders every diagram that includes
it.

**Other PlantUML diagrams** (sequence, class, activity, state, ditaa…) work the same way —
any `@startuml` file is rendered. ditaa (`@startditaa`) always produces PNG.

**Non-Latin text.** Sources are read as UTF-8 (`charset`). The bundled Nimbus Sans font
covers Latin, Cyrillic and Greek, so diagrams look identical on every machine. Scripts it
lacks (e.g. CJK) need `useSystemFonts: true` (or `c4builder --system-fonts` for one run)
and a system font that has them — the output then depends on the machine.

## D2

`.d2` files are rendered by the bundled D2 engine (WASM → SVG), which is the optional npm
dependency `@terrastruct/d2`. A `.d2` file in a project without it stops the build with an
install hint. D2 has no online renderer, so `generateLocalImages` must stay `true`.

- Imports: `@file` / spread `...@file` (without the `.d2` extension), resolved by
  c4builder itself — no network. Keep shared classes in a `_`-prefixed file
  (`src/_c4lib.d2`) and import it with `...@../_c4lib` from a nested folder.
- Layout: `d2Layout` — `dagre` (default) or `elk`.
- Validate like PlantUML: `c4builder check path/to/diagram.d2`.

## Placement and output

- Every diagram of a folder is attached to the folder's page; `![title](name.puml)` /
  `![title](name.d2)` / `![title](name.bpmn)` in a markdown file of the same folder places it
  inline instead.
- Image file = diagram base name + `.svg` (or `.png` with `diagramFormat: png`), next to
  the page in the output.
- A ```` ```plantuml ```` block in a page `.md` is rendered at build time like a `.puml`
  file and replaced by its image in every output (`@startuml` optional, `!include` relative
  to the page folder, a broken block becomes a placeholder plus a warning). To show diagram
  source as code, fence it as `puml` or `text` — those, like `d2` blocks, stay code.
- `embedDiagram: true` inlines images as base64; `includeLinkToDiagram: true` replaces
  images with links.
- Unchanged diagrams are reused from the previous build (checksums in `.c4builder.cache`).
