# Changelog

User-facing changes of C4-Builder. Every pull request that changes behaviour adds a line to
`## Unreleased`; the release commit renames it to `## vX.Y.Z`.

## Unreleased

- The `figma` plugin embeds Figma right inside pages: an image link to Figma on a line of its own
  (`![Payment screen](https://www.figma.com/design/<key>/<name>?node-id=…)`) in a project page or an
  OpenSpec artifact becomes an `Open in Figma: Payment screen` link plus the `embed.figma.com`
  iframe (same normalisation, `height` and `embedHost` as frame pages); inline it becomes a plain
  link, code (fenced and indented blocks, inline code) is untouched, an unparsable link stays with a warning. Pages of plugins listed
  before `figma` are processed, so put it last. `frames` is now optional — without it there is no
  section; the log line counts frame pages and embeds
- OpenSpec artifacts render image links to diagram files next to them — `![Flow](flow.wireflow.json)`,
  `![](context.puml)`, `.d2`, `.bpmn`, `.mmd` — as diagrams, like fenced blocks: the page shows the
  picture, the source is not copied to the output, a broken file gets a placeholder and a warning
- The `openapi` plugin shows AsyncAPI specs too: a matched file with a top-level `asyncapi` key
  gets its own page under the same layout rules (folder index, summary, `info.title`), rendered
  by the bundled official AsyncAPI component (`@asyncapi/react-component` 3.2.2, Apache-2.0) —
  channels, operations, messages and schemas, no CDN and no external requests. The component
  (~3 MB) is copied to the output only when there are AsyncAPI specs and loaded by the browser
  only on their pages; the skip warning now names files without an `openapi`/`swagger`/`asyncapi`
  key
- `c4builder --site -w` serves the site right after the pages are composed instead of waiting
  for every diagram: diagrams missing from the cache show a `rendering…` placeholder and are
  rendered in the background after `serving your docsify site` (`rendering N diagrams in
  background…` → `rendered N diagrams in T s`), the page open in the browser first. A finished
  image replaces its placeholder on the page without a reload; when the queue is done, a regular
  rebuild and one reload bring `embedDiagram`, the complete document and `llms-full.txt` up to
  date and pick up edits made meanwhile. A render error in the background shows an error
  placeholder with `✗` in the log and keeps the server up. Builds without `-w` still wait for
  every diagram and fail on a broken one
- `.c4builder.cache` is written as the rendering goes (at most twice a second and at the end),
  so a build interrupted with Ctrl+C or failed on one diagram keeps the finished diagrams in the
  cache and the next build renders only the rest
- Documentation: `C4BUILDER_RENDER_CONCURRENCY` (parallel PlantUML processes, default
  `min(4, CPU − 1)`) and the warm start in CI (caching `distFolder` and `.c4builder.cache`
  between jobs, GitLab CI and GitHub Actions examples); the documentation site workflow uses
  such a cache
- The docsify site collapses sidebar sections by default (bundled `docsify-sidebar-collapse`
  1.3.5, no external resources): the first level and the path to the current page are open, a
  click on a section expands or collapses it. New `.c4builder` key `sidebarCollapse` (default
  `true`); `false` restores the fully expanded sidebar. The script and style are injected into
  `index.html` after the template and the display level travels in the docsify options, so a
  custom `docsifyTemplate` that puts the options into `window.$docsify` gets collapsing without
  changes — remove a manual `docsify-sidebar-collapse` include from your template (a file the
  template already links is not added twice). When the browser blocks storage (Safari "Block All
  Cookies"), the local `vendor/c4builder-storage-guard.js` substitutes an in-memory one, so the
  collapsed sidebar still works on a phone
- New built-in plugin `figma`: the frames listed in its options (`name`, Figma "Share" `url`,
  optional `description`) become a site section (`mount`, `Figma` by default) with a summary page and
  one page per frame — a live `embed.figma.com` iframe (`height`, `embedHost`) with an `Open in Figma`
  link above it. `/` in a name nests pages. Links are validated and normalised when the plugin loads
  (`design`/`file`/`proto`/`board`/`slides`/`deck`, `node-id` kept; `file` → `design`); a non-Figma
  link, a duplicate name or an empty list fails before the build. The build stays offline and prints
  one line that readers need network access to Figma; `executeScript` and assets are not needed
- Short permanent address of an OpenSpec change page: `#/change/<id>` (`<id>` — the change folder
  name, without the archive date prefix; a nested change by its full id) opens the change page
  whatever the `mount`, `groupKey` and `nameKey` of the `openspec` plugin are, and after archiving
  leads to the newest archived change with that id; the browser swaps it for the real page path
  (keeping a `?id=…` section anchor), so relative links, images and the sidebar highlight work and
  "back" skips the short address. Plugins
  declare such redirects with `ctx.addRedirect(from, to)` in `afterScan` (a repeated short path
  fails the build naming the path and the plugin); the map goes to `$docsify.c4builder.redirects` in
  `index.html` with the local script `vendor/c4builder-redirects.js`, so it works on a published
  site and with a `docsifyTemplate` that outputs the options; a site without redirects is unchanged.
  The `openspec` plugin skips the short address with a warning when the id has `#` or `?` or is
  already taken by another `openspec` instance (the first one wins); the build goes on.
  `--open-change <id>` (with `--site`) opens that address instead of the home page and warns on
  stderr when the site has no such change (`-o, --open` stays a flag without a value); `c4builder feedback --as <id>` prints
  `Change page: http://localhost:<port>/#/change/<id>` on stderr when `<id>` is a change of the
  site (stdout stays the batch). The `c4builder-review` skill links the change page by this address
  instead of searching the build output
- Agent skills are part of the npm package and match the installed CLI version. The new
  `c4builder skills` installs or updates them offline in the current folder: `.agents/skills/`
  always, `.claude/skills/` under Claude Code (`CLAUDECODE`) or when `.claude/` exists. The folder of
  every package skill is replaced as a whole, other skills are left alone, and the installed
  `SKILL.md` gets `metadata.generatedBy: "<version>"`. It needs no `.c4builder` and creates none. A
  stale personal copy `~/.claude/skills/c4builder` (no version or older) is reported on stderr and
  left alone. `npx skills add AlfaCapital-Tech/C4-Builder/skills` stays as the alternative for
  personal installs and other agents
- A build and `c4builder site` run by a coding agent print one stderr line at start when the
  `c4builder` skill this agent loads is missing, older than the CLI, or shadowed by a stale personal
  copy, with `c4builder skills` to run after asking the user. stdout and the exit code do not change;
  no line without an agent, in `c4builder check`, with `CI`, `NO_UPDATE_NOTIFIER`, in the Docker
  image or with `C4BUILDER_AGENT=0`
- `c4builder --new` installs the skills into the new project by the same rules
- Exit codes: without a terminal, `c4builder` in a folder without `.c4builder` prints
  `no .c4builder in <folder> — run c4builder --new, or c4builder --config in a terminal` and exits
  with code 1 instead of a wizard stack trace with code 0; a closed wizard prompt (an incomplete
  config without a terminal, `Ctrl+C`) is one `aborted: the prompt was closed` line and code 1. A
  `.c4builder` that is not valid JSON is an error naming the file and exits with code 1 instead of
  being silently replaced by an empty config. `--site` on a busy port exits with code 1 and no
  longer prints `serving your docsify site` first
- `c4builder --help` shows `Usage: c4builder` and lists the positional commands
- New skill `c4builder-review`: reviewing pages on `c4builder --site -w` with comments to the agent
  (`/c4builder-review [change-id|page]`) — checks the server, links the change page, runs the
  `c4builder feedback --wait --as <name>` loop and reports in the chat. The page feedback loop moved
  there from the `c4builder` skill, which now explains the skills notice. `c4builder-setup` describes
  an npm mirror as the user's npmrc or `--registry` and ends with `c4builder skills` in the project
- Build progress outside a terminal (a background `c4builder --site -w` log, CI) is one line per
  phase, `processed 179 images` / `processed 42 files`, instead of thousands of `\r` updates glued
  into one huge line. The progress in a terminal does not change
- The `--site -w` dev server answers 404 for unknown paths ending in `/` instead of serving the home
  page with 200, so link checks with `curl` see broken links
- Security: zod 4.6.7, undici 7.30.1 and body-parser 2.4.0 to fix npm audit advisories
  (GHSA-mrhx-c7xc-m3w5, GHSA-4qv8-2p9j-2685 and others)
- Wireflow user flows as a fifth diagram engine: a `*.wireflow.json` (or `wireflow.json`) export of
  the [Wireflow](https://github.com/vanila-io/wireflow) editor in a page folder is rendered at build
  time into `<name>.svg`/`.png` — screen cards from the bundled template catalog
  (`vendor/wireflow/`, MIT), notes, groups and bezier/step/smooth-step edges with labels — without a
  browser, network or new npm packages. Formats 2–4 are supported; older files fail with advice to
  re-save them in the editor. Other `.json` files are copied as before. `c4builder check` accepts
  `.wireflow.json` and `wireflow.json` (`✗` per problem with the element id, `⚠` for an unknown
  template or an external image); `llms-full.txt` carries the source as a `json` block with embedded
  images replaced by `"<embedded image>"`. The project template gets a `7 Wireflow Example` section
- The `openapi` plugin gives every spec of a folder its own page: a folder with several specs
  (`billing/openapi.yaml`, `billing/openapi-admin.yaml`) becomes an index page `billing` with links
  and `info.title`, plus `billing/openapi`, `billing/openapi-admin` pages, instead of the
  `two specs give the same page name` error. New option `layout`: `flat` (default) names the folder
  page by the folder name as before, so existing addresses do not change; `tree` nests pages by the
  source folder path (`billing/v2`, `ledger/v2`), and the error for same-named folders in `flat`
  now suggests it. Only a matched file with a top-level `openapi` or `swagger` key is a spec: other
  matched files (schema fragments, AsyncAPI, configs) get no page and a warning each, so a wide
  `glob` like `*/*.{yaml,yml,json}` is safe. The summary lists spec pages with their full path. A
  folder that gains a second spec turns its page into the index; a file named `openapi.yaml`
  without the key loses its page and is reported in the log
- The `openapi` plugin: a `'` in a spec path no longer breaks the script of the swagger-ui and
  AsyncAPI pages — the spec URL carries it as `%27`

## v0.9.0

- Mermaid diagrams are rendered at build time, the fourth engine next to PlantUML, D2 and BPMN:
  `.mmd` files and ```` ```mermaid ```` blocks in project pages and OpenSpec artifacts become SVG or PNG
  images in every output. Real mermaid runs without a browser or network (`@mermaid-js/tiny` in jsdom,
  text metrics from the vendored font), in the classic look with the `default` theme; the output is
  deterministic. `c4builder check` accepts `.mmd` and reports `line N: …`. `llms-full.txt` keeps mermaid
  diagrams as `mermaid` blocks. `mindmap`, `architecture` and KaTeX math are not supported and fail
  with an explicit error. An error in a `.mmd` file fails the build; an error in a block gives a
  placeholder and a warning. The engine is an optional dependency loaded only for projects with mermaid
- `--md` output: a ```` ```mermaid ```` block in a page is now an image, like ```` ```plantuml ````; GitLab
  used to draw such blocks itself
- `site -w`: questions on the page. Select text, press **Question**, type a question and press
  **Add question** — it is appended to the source `.md` of the page under the `questionsHeading` section
  (`Open questions` by default; the new `.c4builder` key): a table row with the next number when the
  section is a table, a list item otherwise, a new section at the end of the file when there is none.
  Watch rebuilds and the page reloads with the question; quoted text is highlighted on the page with
  the question number linking to its row. A × button on a question row removes it from the file.
  Dev-server only: nothing is added to the build output
- `site -w`: feedback to a coding agent from the page. In the agent mode (`--agent`, or run by an agent:
  `CLAUDECODE`, `CODEX_THREAD_ID`, `GEMINI_CLI`, `OPENCODE`, `COPILOT_CLI`, `AI_AGENT`, or
  `C4BUILDER_AGENT`; `--no-agent` or `C4BUILDER_AGENT=0` turn it off) a selection gets a **Feedback**
  button next to **Question**: **Send now** sends one comment, **Add to review** collects comments from
  several pages into a review sent by **Submit review** (with an optional overall comment) or
  **Approve** (nothing more to change). An empty review bar has one button, **Done — no changes** (an
  `approved` batch with no comments); **Discard** only clears the draft. Comments are not written to
  the files. The review draft survives reloads, its quotes are highlighted in blue, the page shows
  whether the agent listens and when a batch is delivered. The new `c4builder feedback --wait --as <name>`
  waits for the next batch for the listener `<name>` (the agent's change or task) and prints it as
  markdown (page, source files, section, quote, comment, `Decision: submitted|approved`); the agent runs
  it in the background and again after each batch with the same name. Without `--as`, or with an
  invalid name, it exits with code 2 and an example, without contacting the server
- `site -w`: several agents on one server. Every listener name gets a mailbox: a batch goes only to the
  agent it was sent to and waits for it between runs; a batch sent before any agent came goes to the
  first one. With several agents the review bar shows **Send to** with their names and state
  (`listening` / `reconnecting`, queued batches); the choice is per tab, so three tabs can work with
  three agents, and each recipient has its own review draft. Toasts name the recipient («Queued for
  foo», «Delivered to foo»). An empty mailbox leaves the list after 30 minutes
- `site -w`: the page interface (selection buttons, popovers, review bar, toasts) is in English or
  Russian, following the browser language; the new `.c4builder` key `uiLanguage` (`auto` by default,
  `en`, `ru`) pins it. Russian counts are declined («1 замечание», «5 замечаний»). CLI output, feedback
  batches, server error texts and `questionsHeading` stay as they were
- `site -w`: when another c4builder process holds the build lock of the same folder (a second
  `site -w`), the watch rebuild now waits for it (up to a minute) instead of skipping, so the browser
  still gets its reload
- Coming from 0.9.0-rc.1…rc.3: `c4builder feedback` requires `--as <name>` since rc.4, and an older
  `feedback` against a newer `site -w` fails with `unexpected response 400` — update both. The question
  buttons were **Comment** / **Add** in rc.1

## v0.8.0

- `openspec` plugin: the new `groupKey` option splits top-level changes into groups, e.g. by team.
  A `.openspec.yaml` key (e.g. `x-team: Service`) sets the group: the change page moves to
  `Changes/<group>/<id>`, every group gets a page with its table, and the Changes table and the archive
  list get per-group sections (changes without a group last, under `Ungrouped`). Without the option the
  section is unchanged
- `openspec` plugin: the new `nameKey` option labels a top-level change with a human name from
  `.openspec.yaml` (e.g. `x-name: DIG-12 Card payment`) instead of its id; the name is also its page
  path segment. A value with `/`, `#`, `?` or a duplicate in the same folder keeps the id
- `openspec` plugin: the new `columns` option adds `.openspec.yaml` columns to the Changes table,
  the summary and the group pages, e.g. `[{ "key": "x-assignee", "title": "Assignee" }]`
- `openspec` plugin: a quoted `.openspec.yaml` value is read whole — a `#` inside the quotes is not a
  comment (`x-name: "Task #5"`)

## v0.7.0

- `openspec` plugin: the new `parentKey` option nests a change under its parent change. A
  `.openspec.yaml` key (e.g. `x-parent: dig-1-root`) points at the parent; the child gets a page
  under it labelled with the id tail (`dig-1-root-ios` → `ios`), a row right below it in the
  Changes table and the archive list, and `Parent` / `Sub-changes` links. Without the option the
  section is unchanged

## v0.6.0

- New version notice: once a day c4builder asks the npm registry from your npmrc for the newest
  version in a detached background process, so a run never waits for the network. When a newer
  version is known, a run ends with one stderr line
  `c4builder <new> is available (current <current>). Run: c4builder update`, and
  `c4builder site -w` shows a dismissible banner (never written to the build output). Off in CI
  (`CI` is set), in the Docker image and with `NO_UPDATE_NOTIFIER=1`
- `c4builder update` installs the newest version over a global npm install; for a project
  dependency or the Docker image it installs nothing, prints the update command and exits with
  code 1

## v0.5.1

- The `openspec` plugin inlines markdown files embedded with `':include'` (e.g. `_back/back.md`
  of a `design.md`) at build time: their diagrams are rendered locally and their links resolve
  from the embedded file. Before, the embed path was rewritten from the site root, docsify
  loaded it relative to the page, got 404 and showed an empty page. Other `':include'` embeds
  keep a path relative to the page

## v0.5.0

- **BREAKING:** Node.js 22.17 or newer is required (`engines.node: ">=22.17"`); Node.js 20 is
  past its end of life. On older Node.js npm warns with `EBADENGINE` (or refuses with
  `engine-strict`); the Docker image is not affected
- The `openapi` plugin finds specs with Node's built-in `fs.globSync`: specs inside directories
  whose names start with a dot (`.foo/openapi.yaml`) are no longer found
- Documentation site in Russian and English with a landing page, built by c4builder itself and
  published to GitHub Pages: https://alfacapital-tech.github.io/C4-Builder/. The reference moved
  there from the README; the change log moved to `CHANGELOG.md`.
- `c4builder --docs` and the `readme.md` of new projects link to the fork's documentation site
  instead of the upstream one.
- `c4builder new` and `c4builder config` work as positional subcommands (the form the README
  and the CLI hints use) — they used to silently start a build; an unknown positional command
  now fails with `unknown command` and exit code 1 instead of building
- Agent skills for coding agents in `skills/`, installed with
  `npx skills add AlfaCapital-Tech/C4-Builder/skills`: `c4builder` (project layout, the
  edit → check → build loop, C4-PlantUML and D2 conventions, plugins) and `c4builder-setup`
  (install, update, diagnose)
- New projects (`--new`) contain `AGENTS.md` with build and check instructions for coding
  agents; it is not part of the generated documentation
- `llms.txt` / `llms-full.txt` for AI agents (`generateLLMS`, needs the website): a page index in
  sidebar order and the full text with diagram sources instead of images, local includes listed
  once in an appendix. On for new projects; an existing `.c4builder` without the key builds as
  before
- `c4builder check` output is in English: errors read `✗ <file>: line <N>: <message>` (was
  `строка <N>` — update scripts that match it), usage and unsupported-extension messages too.
  A `.iuml` calling C4 macros (`UpdateElementStyle`…) now passes `check`: after an engine error
  it is re-checked with the C4 stdlib included
- `c4builder --docs` no longer creates `.c4builder` and `.c4builder.cache` in the current
  folder; `--list` and `--reset` outside a project fail with exit code 1 instead of creating them
- The generated site makes no external requests: the copied `vendor/vue.css` drops its Google
  Fonts `@import` (system fonts), emoji are native characters (`nativeEmoji: true`, also passed
  to custom `docsifyTemplate`s) instead of GitHub images, the built-in template no longer loads
  `docsify-plantuml` (the file is still copied for custom templates), and `openapi` swagger-ui
  pages no longer call `validator.swagger.io`
- **BREAKING (output):** ```` ```plantuml ```` blocks in page `.md` files are rendered at build
  time and become images in every output (site, markdown, complete markdown); their source no
  longer reaches the browser or plantuml.com. To show diagram source as code, fence it as
  `puml` or `text`
- All CLI output is in English: config, build, plugin, JRE and lock errors, warnings, wizard
  validation and the "diagram not rendered" placeholder used to be in Russian — update scripts
  that match the old messages
- BPMN diagrams: `.bpmn` files (BPMN 2.0 XML, semantic part only — coordinates are not needed
  and ignored) are validated (bpmnlint recommended rules plus lane, pool and message-flow rules),
  laid out automatically with horizontal pools and lanes and rendered offline to SVG/PNG in the
  standard notation; `c4builder check` accepts `.bpmn` and prints one `<file>: <id> [<rule>]
  <message>` line per problem. The engine (`bpmn-js`, `bpmn-moddle`, `bpmnlint`,
  `bpmn-auto-layout`, `jsdom`) is an optional dependency loaded only for projects with `.bpmn`;
  installs with `--omit=optional` stop such builds with an install hint. New projects contain the
  "5 BPMN Example" section

## v0.4.0

- Plugin system: `plugins` key in `.c4builder`, `afterScan`/`afterBuild` hooks, virtual pages,
  plugin assets injected into `index.html`, `dir`/`archive` source resolver
  (see [Plugins](docs/en/src/06%20Plugins/README.md))
- Built-in plugins: `openspec` (local OpenSpec store → site section, local diagram render) and
  `openapi` (offline swagger-ui pages for a set of OpenAPI specs; `vendor/swagger-ui/swagger-ui.css` 5.32.1)
- `c4builder check <file...>` — validate individual `.puml` / `.iuml` / `.d2` files with the
  bundled engines, without a project build (#13)
- D2 compile errors are printed as readable `file:line:col: message` lines instead of raw JSON
- Regression test for two adjacent `![..](x.puml)` embeds (#12 — the bug itself was fixed in 0.3.0)
- Diagram cache key now includes the output path: diagrams that swap contents (or fence blocks
  that shift position) are re-rendered instead of silently reusing a neighbour's cached image.
  The first build after upgrading re-renders everything once.
- Watch mode ignores the output folder, its backup and `.c4builder*`, and de-duplicates nested
  watch roots (a plugin `dir` covering the project no longer loops the rebuild)
- A broken ```` ```plantuml ````/```` ```d2 ```` block inside an OpenSpec artifact no longer fails
  the build: the page gets a placeholder image and the warning names the source file
- Diagram errors name the file the diagram came from (fence names are content hashes)
- `{a,b}` glob alternatives accept `*`/`?` inside them (`{*.yaml,*.yml}`)
- Archive download failures caused by a TLS-intercepting proxy suggest `NODE_EXTRA_CA_CERTS`
- `c4builder site` works as a positional subcommand, the same as `--site` (it is the form the
  post-build hint prints)
- PlantUML updated to 1.2026.8: filled arrowheads for `>>` decorations in Smetana layout (#14).
  Note: `!pragma layout elk` now requires Java 21
- Security: runtime dependencies bumped (figlet, tar, qs) to fix npm audit advisories

## v0.3.0

Full TypeScript rewrite (ESM, Node.js ≥ 20.19) with the same CLI and `.c4builder` format.

- PlantUML renders via a direct `java` call with the built-in Smetana layout — graphviz
  is no longer needed; the jar is bundled (`vendor/`)
- Java itself is optional: system java ≥ 17 is used when present, otherwise a private
  JRE is downloaded automatically (`c4builder jre install` / `jre info`)
- Second diagram backend: [D2](https://d2lang.com) (`.d2` files, optional
  `@terrastruct/d2` dependency, imports supported)
- `diagramFormat: png` rasterizes SVG with `@resvg/resvg-js` — deterministic PNG for
  PlantUML and D2 alike
- Bundled Nimbus Sans font for identical diagram geometry everywhere;
  `useSystemFonts` / `--system-fonts` opts out
- Config is validated (zod): typos and wrong types fail with a clear message
- Docker image on GHCR with a tag scheme in sync with npm dist-tags
  (see [Docker and CI](docs/en/src/07%20Docker%20and%20CI/README.md))
- PDF output removed — use the docsify site or the single/collection markdown outputs
  instead (the `pdf`/`pdfCss` options no longer exist)

## v0.2.20

Fork by [Alfa Capital Technologies](https://alfacapital.tech)

- Updated commander to v14 (fixed compatibility with Node.js 20+)
- Updated dependencies: fs-extra 11.x, node-watch 0.7.x
- PlantUML updated to 1.2025.2
- Added Dockerfile and CI for building Docker image to GHCR
- Added CI for npm publishing via OIDC (Trusted Publisher)
- Published as [@alfacapital-tech/c4builder](https://www.npmjs.com/package/@alfacapital-tech/c4builder)

## v0.2.16

Partial build (image generation) [#55](https://github.com/adrianvlupu/C4-Builder/pull/58) ([MickeJohannesson](https://github.com/MickeJohannesson))

Bugfixes

## v0.2.14

Diagrams at arbitrary positions [#28](https://github.com/adrianvlupu/C4-Builder/pull/28) ([Sjuanola](https://github.com/sju66))

Support for Ditaa Diagrams [#56](https://github.com/adrianvlupu/C4-Builder/pull/56) ([MickeJohannesson](https://github.com/MickeJohannesson))

Resolved npm vulnerabilities

Latest plantuml jar file 1.2022.3.jar

Dockerfile [#51](https://github.com/adrianvlupu/C4-Builder/pull/51) ([craigwardman](https://github.com/craigwardman))

Search in site sidebar [#48](https://github.com/adrianvlupu/C4-Builder/pull/48) ([arifinoid](https://github.com/arifinoid))

## v0.2.12

Relative urls in TOC for multiple markdown files [#9](https://github.com/adrianvlupu/C4-Builder/issues/5).

Fixed Processed 1/1..2/2 files bug.

Added another version of the PlantUML jar file.

## v0.2.11

Updated latest plantuml jar to 1.2021.7.jar [#41](https://github.com/adrianvlupu/C4-Builder/pull/41) ([pandasuit](https://github.com/pandasuit))

Allow input plantuml source files to use relative include statements to other plantuml files [#42](https://github.com/adrianvlupu/C4-Builder/pull/42) ([pandasuit](https://github.com/pandasuit))

Local image generation in sequence due to the jar failing with "dot executable not found".

## v0.2.9

Updated VSCode snippets and resolved npm audit issues

Docsify image plugin [#20](https://github.com/adrianvlupu/C4-Builder/pull/20) ([alefcarlos](https://github.com/alefcarlos))

PlantUML 1.2020.17 [#23](https://github.com/adrianvlupu/C4-Builder/pull/23) ([RohanTalip](https://github.com/RohanTalip))

Configurable PlantUML Server url [#25](https://github.com/adrianvlupu/C4-Builder/pull/25) ([jikuja](https://github.com/jikuja)), [#29](https://github.com/adrianvlupu/C4-Builder/pull/29) ([coryodaniel](https://github.com/coryodaniel))

GitHub Action for running C4 Builder in CI [#16](https://github.com/adrianvlupu/C4-Builder/issues/16) ([hkdobrev](https://github.com/hkdobrev))

Overloading the docsify template [#27](https://github.com/adrianvlupu/C4-Builder/pull/27) ([sju66](https://github.com/sju66))

## v0.2.12

Relative urls in TOC for multiple markdown files [#9](https://github.com/adrianvlupu/C4-Builder/issues/5).

Fixed Processed 1/1..2/2 files bug.

Added another version of the PlantUML jar file.

## v0.2.7

Resolved npm audit issues

The projects generated now support PlantUML versioning

PlantUML jar files included

## v0.2.4

Solved the limation of including local images in the markdown files.

Updated the project template with the diagram descriptions from [C4Model](https://c4model.com/#CoreDiagrams)

## v0.2.3

Updated template to include the new `Dynamic Diagram` in C4-PlantUML and fixed `npm audit` issues.

## v0.2.1 + v0.2.2

Added the `c4builder --watch` option and some refactoring.

## v0.2.0

Pdf generation now uses `puppeteer`. There are no more scaling issues for high resolution displays. Used the `css` file from [vscode-markdown-pdf](https://github.com/yzane/vscode-markdown-pdf.git).

Removed unused dependencies.

## v0.1.9

Thanks to [howiefh](https://github.com/howiefh) for adding the [charset option](https://github.com/adrianvlupu/C4-Builder/pull/1).

## v0.1.8

Updated template to include the new `Deployment Diagram` in C4-PlantUML and more info inside `readme.md`

`node-plantuml` accepted the pull request [#29](https://github.com/markushedvall/node-plantuml/pull/29) so I changed the dependency back to the original repository.

## v0.1.7

Changed template to include the latest C4-PlantUML`!include https://raw.githubusercontent.com/adrianvlupu/C4-PlantUML/latest/...`

## v0.1.6

Switched from http-server module to express for serving the static site.

Added the option to place diagrams before text.

## v0.1.5

PlantUML recently switched to V1.2019.6 adding some breaking changes to `!define` and `!definelong`. You can still use them but when calling you have to add `()` method call (http://plantuml.com/preprocessing)

Considering they updated their server to use the new version, diagrams generated locally that display correctly won't work on the plantuml server and viceversa

Until the underlying `node-plantuml` package gets updated, I changed the dependency to the fork at https://github.com/adrianvlupu/node-plantuml.git

Also the `!include` directives on each template diagram point to the 1.2019.6 compatible version hosted at https://github.com/adrianvlupu/C4-PlantUML.
