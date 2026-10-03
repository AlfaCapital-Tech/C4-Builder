# `.c4builder` reference

`.c4builder` is a JSON file in the project root (another path: `c4builder -c <path>`).
`c4builder --list` prints the effective values, `c4builder --docs` explains the wizard
questions, `c4builder --config` re-runs the wizard (interactive — prefer editing the JSON).

Validation rules:

- **Unknown keys are silently dropped.** A misspelled key (`generateWeb`) changes nothing —
  compare every key with the tables below.
- A wrong type (a string where a boolean is expected, a bad port) fails the build with a
  message naming the key. `null` means "not set" → default.
- The wizard asks for every key it knows that is **missing** from the file, so a
  non-interactive build needs a complete config — like the one
  `c4builder --new --name <name> -y` writes (below). `hasRun: true` (set after the first
  successful build) makes invalid values fail the build instead of being asked again.

## Sources and outputs

| Key | Default | Meaning |
|---|---|---|
| `projectName` | — | documentation title; name of the complete markdown file |
| `homepageName` | `Overview` | title of the root page |
| `rootFolder` | `src` | source folder |
| `distFolder` | `docs` | output folder — **wiped on every build** |
| `generateMD` | `true` | markdown collection: `README.md` per folder |
| `generateCompleteMD` | `false` | one `<projectName>.md` with everything |
| `generateWEB` | `true` | docsify site (`index.html`, `<folder>.md` per folder) |
| `excludeOtherFiles` | `false` | do not copy non-diagram, non-markdown files (images…) |

## Page content

| Key | Default | Meaning |
|---|---|---|
| `diagramsOnTop` | `true` | attached diagrams before the text (after a leading `#` title) |
| `includeBreadcrumbs` | `true` | folder path under the title |
| `includeNavigation` | `false` | markdown collection: links to parent and children |
| `includeTableOfContents` | `true` | markdown collection: tree of all pages on every page |
| `includeLinkToDiagram` | `false` | a link to the image instead of the image |
| `embedDiagram` | `false` | images inlined as base64 data URIs |
| `charset` | `UTF-8` | encoding of diagram sources |

## Diagrams

| Key | Default | Meaning |
|---|---|---|
| `generateLocalImages` | `true` | render locally (Java + bundled PlantUML, bundled D2). `false` = PlantUML images are links to `plantumlServerUrl`; a project with `.d2` files then fails |
| `plantumlServerUrl` | `https://www.plantuml.com/plantuml` | server for `generateLocalImages: false` |
| `diagramFormat` | `svg` | `svg` or `png` (PNG is rasterized from SVG; ditaa is always PNG) |
| `d2Layout` | `dagre` | D2 layout engine: `dagre` or `elk` |
| `useSystemFonts` | `false` | machine fonts instead of the bundled one — output differs per machine (`--system-fonts` for one run) |

## Site (docsify)

| Key | Default | Meaning |
|---|---|---|
| `webPort` | `3000` | port of `c4builder --site` (`-p <n>` overrides) |
| `webTheme` | `vendor/vue.css` | docsify theme stylesheet |
| `supportSearch` | `true` | search box in the sidebar |
| `repoUrl` | `""` | repository link in the site corner |
| `executeScript` | `false` | let docsify run `<script>` in pages (forced on by `openapi`) |
| `docsifyTemplate` | `""` | path to a JS module exporting a function that returns `index.html` |
| `webFileName` | — | fixed file name for every site page instead of the folder name |
| `excludeSidebarFolderByPath` | — | array of folder paths, **including** `rootFolder` (`"src/2 Deployment"`), hidden from the sidebar |

## Plugins

| Key | Default | Meaning |
|---|---|---|
| `plugins` | `[]` | `"name"` or `["name", { options }]` — see [plugins.md](plugins.md). Unlike other keys, a malformed entry always fails the build |

Legacy keys (`plantumlVersion`, `generatePDF`, `generateCompletePDF`) only produce a
warning — remove them when you see one.

Complete config written by `c4builder --new --name demo -y` — start from it when adding
c4builder to an existing repository:

```json
{
  "projectName": "demo",
  "homepageName": "Overview",
  "rootFolder": "src",
  "distFolder": "docs",
  "generateMD": true,
  "generateCompleteMD": false,
  "generateWEB": true,
  "includeNavigation": false,
  "includeTableOfContents": true,
  "webTheme": "vendor/vue.css",
  "supportSearch": true,
  "repoUrl": "",
  "executeScript": false,
  "docsifyTemplate": "",
  "webPort": "3000",
  "includeBreadcrumbs": true,
  "includeLinkToDiagram": false,
  "diagramsOnTop": true,
  "embedDiagram": false,
  "excludeOtherFiles": false,
  "generateLocalImages": true,
  "plantumlServerUrl": "https://www.plantuml.com/plantuml",
  "diagramFormat": "svg",
  "d2Layout": "dagre",
  "charset": "UTF-8",
  "useSystemFonts": false
}
```
