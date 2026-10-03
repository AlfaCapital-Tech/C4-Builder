# CLI & configuration

## Commands

| Command | What it does |
|---|---|
| `c4builder` | builds the project in the current folder; without a config it runs the wizard first |
| `c4builder --new` | creates a project from the template in a new folder; since 0.5.0 also `c4builder new` |
| `c4builder --new --name demo -y` | the same without questions: a full config with default values |
| `c4builder --config` | setup wizard with the current values; since 0.5.0 also `c4builder config` |
| `c4builder site` | builds and serves the site locally (same as `--site`) |
| `c4builder --site -w` | the same, rebuilding on every save and reloading the browser |
| `c4builder check <files...>` | checks `.puml`, `.iuml`, `.d2` diagrams without a build, exit code 0 or 1 |
| `c4builder jre info` | which Java will be used (JSON) |
| `c4builder jre install [--force]` | download a JRE into the cache in advance; `--force` — even if system Java exists |
| `c4builder --list` | print the current config; since 0.5.0 outside a project — an error with exit code 1, no files created |
| `c4builder --reset` | clear the project config; since 0.5.0 outside a project — an error with exit code 1 |
| `c4builder --docs` | short reference of config keys and the address of this documentation |

Positional commands are `check`, `jre`, `site`, and since 0.5.0 also `new` and `config`. Since
0.5.0 any other positional argument is an `unknown command` error with exit code 1: a typo
(`c4builder nwe`) no longer starts a build.

Flags:

| Flag | Meaning |
|---|---|
| `-c, --config-file <path>` | a different config file instead of `.c4builder` |
| `-w, --watch` | rebuild on changes in the sources and plugin folders |
| `-o, --open` | open the site in the browser (with `--site`) |
| `-p, --port <n>` | port for `--site` (defaults to `webPort` from the config, 3000) |
| `--system-fonts` | render with system fonts for one run |
| `-V, --version` | version |

## How the config is read

`.c4builder` is JSON in the project folder. The first build asks for missing keys through the
wizard and sets `hasRun: true`; after that, `c4builder` builds without questions. `new -y` writes
a full config right away, so there is no wizard at all.

Keys are validated against a schema. A value of the wrong type stops the build with an error
naming the key, and `c4builder --config` lets you fix it. Unknown keys are silently dropped — this
way an older c4builder does not fail on a config written by a newer one. Keys of features removed
in older versions produce a warning listing them, and the build continues.

## `.c4builder` keys

| Key | Default | What it sets |
|---|---|---|
| `projectName` | name given at creation | project name: title of the site and of the single file |
| `homepageName` | `Overview` | title of the root page |
| `rootFolder` | `src` | sources folder |
| `distFolder` | `docs` | output folder, recreated on every build |
| `generateWEB` | `true` | docsify site |
| `generateMD` | `true` | markdown per folder |
| `generateCompleteMD` | `false` | single `<projectName>.md` file |
| `generateLLMS` | `true` in new projects, off when absent | `llms.txt` and `llms-full.txt` for agents, needs `generateWEB` (since 0.5.0) |
| `includeTableOfContents` | `true` | page tree at the top of each markdown file |
| `includeNavigation` | `false` | links to the parent and child pages in markdown |
| `includeBreadcrumbs` | `true` | page path under the title |
| `diagramsOnTop` | `true` | diagrams before the page text |
| `includeLinkToDiagram` | `false` | a link instead of the diagram image |
| `embedDiagram` | `false` | image embedded in markdown as base64 |
| `excludeOtherFiles` | `false` | do not copy other files from the sources |
| `generateLocalImages` | `true` | local rendering; `false` — links to an online server |
| `plantumlServerUrl` | `https://www.plantuml.com/plantuml` | server for `generateLocalImages: false` |
| `diagramFormat` | `svg` | `svg` or `png` |
| `d2Layout` | `dagre` | D2 layout: `dagre` or `elk` |
| `useSystemFonts` | `false` | system fonts instead of the bundled one |
| `charset` | `UTF-8` | encoding of PlantUML sources |
| `webTheme` | `vendor/vue.css` | docsify CSS theme |
| `supportSearch` | `true` | search in the sidebar |
| `repoUrl` | empty | repository link in the corner of the site |
| `executeScript` | `false` | run `<script>` in pages and load swagger-ui |
| `docsifyTemplate` | empty | path to a module with a custom `index.html` template |
| `webPort` | `3000` | port of `c4builder site` |
| `webFileName` | — | one `.md` name for all site pages instead of the folder name |
| `excludeSidebarFolderByPath` | — | list of paths (from the project folder, e.g. `src/Archive`) hidden from the sidebar |
| `plugins` | `[]` | build plugins, see [Plugins](06%20Plugins/06%20Plugins.md) |

The config of this documentation site is a live example: `docs/en/.c4builder` in the repository.

## Custom docsify template

`docsifyTemplate` points to an ESM or CommonJS module that exports a function. The function
receives the docsify settings object (name, sidebar, theme, search) and returns the HTML for
`index.html`. Start from the built-in template in `src/core/compose/docsify.template.ts`; this
site uses its own, `docs/docsify-template.mjs`.
