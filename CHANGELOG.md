# Changelog

User-facing changes of C4-Builder. Every pull request that changes behaviour adds a line to
`## Unreleased`; the release commit renames it to `## vX.Y.Z`.

## Unreleased

- **BREAKING:** Node.js 22.17 or newer is required (`engines.node: ">=22.17"`); Node.js 20 is
  past its end of life. On older Node.js npm warns with `EBADENGINE` (or refuses with
  `engine-strict`); the Docker image is not affected
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

## v0.4.0

- Plugin system: `plugins` key in `.c4builder`, `afterScan`/`afterBuild` hooks, virtual pages,
  plugin assets injected into `index.html`, `dir`/`archive` source resolver (see «Plugins»)
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
- Docker image on GHCR with a tag scheme in sync with npm dist-tags (see [Docker](#docker))
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
