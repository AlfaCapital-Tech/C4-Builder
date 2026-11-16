# `.c4builder` reference

`.c4builder` is a JSON file in the project root (another path: `c4builder -c <path>`).
`c4builder list` prints the effective values, `c4builder docs` explains the wizard
questions, `c4builder config` re-runs the wizard (interactive — prefer editing the JSON).

Validation rules:

- **Unknown keys are silently dropped.** A misspelled key (`generateWeb`) changes nothing —
  compare every key with the tables below.
- A wrong type (a string where a boolean is expected, a bad port) fails the build with a
  message naming the key. `null` means "not set" → default.
- The wizard asks for every key it knows that is **missing** from the file, so a
  non-interactive build needs a complete config — like the one
  `c4builder new --name <name> -y` writes (below). `hasRun: true` (set after the first
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
| `generateLLMS` | `true` in new projects, off when absent | `llms.txt` (page index) and `llms-full.txt` (full text, diagrams as source) in the site root; needs `generateWEB` |
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

Diagrams are always rendered locally (Java + bundled PlantUML, bundled D2, BPMN, mermaid and
wireflow engines); there is no online render mode, and diagram sources never leave the machine.
An old `.c4builder` with the removed online-render keys still builds locally: only
`generateLocalImages: false` prints a warning naming `generateLocalImages` and
`plantumlServerUrl`; `generateLocalImages: true` and any `plantumlServerUrl` are silently
ignored. Delete both keys from the file.

| Key | Default | Meaning |
|---|---|---|
| `diagramFormat` | `svg` | `svg` or `png` (PNG is rasterized from SVG; ditaa is always PNG) |
| `d2Layout` | `dagre` | D2 layout engine: `dagre` or `elk` |
| `useSystemFonts` | `false` | machine fonts instead of the bundled one — output differs per machine (`--system-fonts` for one run) |

## Site (docsify)

| Key | Default | Meaning |
|---|---|---|
| `webPort` | `3000` | port of `c4builder site` (`-p <n>` overrides); `feedback`, `doctor` and `status` prefer the port of the running site from `.c4builder.server.json` |
| `buttons` | — | own labels of the buttons of `site -w`: `{ "agent": "…", "comment": "…", "approve": "…", "push": "…" }` — instead of **Tell agent**, **Comment**, **Approve row** and **Push** (review log bar), shown as is in any interface language; `buttons.comment` overrides the legacy `reviewLog.label`; a `label` inside `comments` is ignored with a warning |
| `comments` | — | review log for the **Comment** button of `site -w` (former name `reviewLog`, still read when `comments` is absent): `{ "enabled": true, "file": "review.md", "heading": "Review" (or a list of variants), "cells": ["", "{artifact} → {section}", "{text}", "{author}", ""], "author": "" }` — the nearest `file` from the page's source up to the project root, a row of the `heading` table from the `cells` template (`{comment}`, `{quote}`, `{text}`, `{section}`, `{artifact}`, `{page}`, `{author}`, `{date}`, `{number}`); `author` defaults to `git config user.name`; no key — no button. `approve: { "heading": "Statuses" (or a list), "who": "Who", "set": { "Status": "Approved", "Date": "{date}" } }` — the **Approve row** button at a selection within one row of that status table on the log page: writes the `set` cells by column header (`{date}`, `{author}` = the `who` cell), commits and pushes the log. `push: { "enabled": true, "message": "review {change}: {action} — {author}" }` — the review log bar with a **Push** button on a change page while its log has something to push (changed file or an unpushed log commit; state from the server on every render); `message` (`{change}`, `{action}` = `approved`/`comments`, `{author}`, `{file}`) is shared with approve. Both commit only the log file (other working copy changes and the index untouched, no stash), move the log commit onto a moved upstream (a conflict is an error, the commit stays local), push only to an upstream branch of the same name, without force; they refuse while the branch has unpushed commits other than log commits or a merge/rebase is in progress; git never prompts (ssh runs with `BatchMode=yes` unless `core.sshCommand`/`GIT_SSH_COMMAND` is set), `commit.gpgsign` is kept; a row counts as approved when every `set` value without placeholders is there exactly (case matters) — a `set` without such values gets a build warning |
| `uiLanguage` | `auto` | language of the `site -w` page interface: `auto` (browser language), `en` or `ru`; CLI output and feedback batches stay English |
| `webTheme` | `vendor/vue.css` | docsify theme stylesheet |
| `supportSearch` | `true` | search box in the sidebar |
| `sidebarCollapse` | `true` | collapsible sidebar sections (bundled `docsify-sidebar-collapse`): first level and the path to the current page open; `false` — whole tree expanded. Injected into `index.html` after the template, so a custom `docsifyTemplate` needs no changes |
| `repoUrl` | `""` | repository link in the site corner |
| `executeScript` | `false` | let docsify run `<script>` in pages (forced on by `openapi`) |
| `docsifyTemplate` | `""` | path to a JS module exporting a function that returns `index.html` |
| `webFileName` | — | fixed file name for every site page instead of the folder name |
| `excludeSidebarFolderByPath` | — | array of folder paths, **including** `rootFolder` (`"src/2 Deployment"`), hidden from the sidebar |

## Plugins

| Key | Default | Meaning |
|---|---|---|
| `plugins` | `[]` | `"name"` or `["name", { options }]` — see [plugins.md](plugins.md). Unlike other keys, a malformed entry always fails the build |

Legacy keys (`plantumlVersion`, `generatePDF`, `generateCompletePDF`, `generateLocalImages: false`)
only produce a warning — remove them when you see one. `plantumlServerUrl` and
`generateLocalImages: true` are dropped without a warning; remove them too.

Complete config written by `c4builder new --name demo -y` — start from it when adding
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
  "generateLLMS": true,
  "includeNavigation": false,
  "includeTableOfContents": true,
  "webTheme": "vendor/vue.css",
  "supportSearch": true,
  "sidebarCollapse": true,
  "repoUrl": "",
  "executeScript": false,
  "docsifyTemplate": "",
  "webPort": "3000",
  "includeBreadcrumbs": true,
  "includeLinkToDiagram": false,
  "diagramsOnTop": true,
  "embedDiagram": false,
  "excludeOtherFiles": false,
  "diagramFormat": "svg",
  "d2Layout": "dagre",
  "charset": "UTF-8",
  "useSystemFonts": false
}
```
