# Plugins reference

Plugins add pages from outside `rootFolder` (they go through the normal pipeline: sidebar,
search, markdown outputs, local diagram rendering) and site assets. They are listed in
`.c4builder`:

```json
{
  "plugins": [
    "openspec",
    ["openapi", { "dir": "../contracts", "glob": "*/openapi.yaml" }]
  ]
}
```

- An entry is `"name"` or `["name", { options }]`. A malformed entry always fails the build.
- Name resolution: built-in (`openspec`, `openapi`, `figma`) → local ESM module
  (`./plugins/my.mjs`, relative to the project) → npm package installed in the project.
- Options are validated before the build; built-in plugins reject unknown option keys.
- `${ENV_VAR}` inside string options is replaced from the environment (unset → empty) and
  never printed — keep tokens there, not in the file.
- Plugin folders are watched by `c4builder --site -w`.
- Hooks run in list order; an exception aborts the build and names the plugin.

## `openspec` — OpenSpec store as a site section

Renders an [OpenSpec](https://github.com/Fission-AI/OpenSpec) store: a summary page
(counters, task progress), one page per active change (header + first artifact, the other
artifacts and spec deltas as subpages), the specs tree and the archive. `plantuml` / `d2` /
`mermaid` fenced blocks in artifacts and image links to diagram files next to them
(`![](flow.wireflow.json)`, `.puml`, `.d2`, `.bpmn`, `.mmd`) are rendered by the local engines; a
broken one gets a placeholder image and a warning naming the file instead of failing the build.

| Option | Default | Meaning |
|---|---|---|
| `dir` | `openspec` | store folder, relative to the project |
| `mount` | `OpenSpec` | section name and its path in the output |
| `artifacts` | `["proposal", "design", "tasks"]` | artifact order; the first is shown on the change page |
| `parentKey` | — | `.openspec.yaml` key pointing at the parent change (e.g. `x-parent`); when set, child changes are nested under their parent in the sidebar, the Changes table and the archive |
| `groupKey` | — | `.openspec.yaml` key with the change's group (e.g. `x-team`); when set, top-level changes go to `Changes/<group>/<id>`, the Changes table and the archive get per-group sections |
| `nameKey` | — | `.openspec.yaml` key with the change's name (e.g. `x-name`); when set, the name labels the top-level change and is its page path segment (falls back to the id on `/`, `#`, `?` or a duplicate) |
| `columns` | — | extra Changes table columns from `.openspec.yaml`: `[{ "key": "x-assignee", "title": "Assignee" }]`; missing value — `—` |

Change page addresses: `#/<mount>/Changes/<group>/<name or id>/<name or id>`, nested
`…/<parent>/<id tail>/<id tail>`, archived `#/<mount>/Archive/<date>-<id>/<date>-<id>`. Do not
build them by hand: every change has the short permanent address `#/change/<id>` (`<id>` — the
change folder name, without the archive date prefix; a nested change by its full id). It opens the
active change, after archiving the newest archived one with that id, and the browser swaps it for
the real page path. The map is in `index.html` (`$docsify.c4builder.redirects`), so it works on a
published site too; a custom `docsifyTemplate` must write the received options into
`window.$docsify` as a whole. `c4builder --site -w --open-change <id>` opens this address and
`c4builder feedback --as <id>` prints it on stderr as `Change page: …`.

## `openapi` — swagger-ui and AsyncAPI pages for API specs

One page per spec found by `glob` plus a summary; swagger-ui is bundled, readers need no
network. Exactly one source — `dir` **or** `archive` — is required. It forces
`executeScript: true`.

- A matched file is a spec only with a top-level `openapi`/`swagger` (OpenAPI, swagger-ui page) or
  `asyncapi` (AsyncAPI, page rendered by the bundled AsyncAPI component) key; other matched files
  get no page and a `⚠ openapi: <path>: not an OpenAPI or AsyncAPI document` warning each, so
  `glob: "*/*.{yaml,yml,json}"` is safe.
- Pages follow the source folders: a folder with one spec is that spec's page (`billing`); a
  folder with several specs is an index page (`billing`, links with `info.title`, `openapi.*`
  first) plus `billing/<file-without-extension>` per spec; a root spec is named after its file.
- `layout: "flat"` (default) names the folder page by the folder name wherever it sits —
  existing addresses do not change; same-named folders in different places fail the build and
  the message suggests `layout: "tree"`, which uses the folder path from the source root
  (`billing/v2`, `ledger/v2`). Two pages with the same path fail the build naming both files.

| Option | Default | Meaning |
|---|---|---|
| `mount` | `API` | section name |
| `dir` | — | local folder with specs (watched) |
| `archive` | — | HTTP(S) URL of a `tar.gz` / `zip` archive (e.g. a repository archive) |
| `subdir` | — | folder inside the archive or `dir` |
| `headers` | — | HTTP headers for the archive request, e.g. `{"PRIVATE-TOKEN": "${GITLAB_TOKEN}"}` |
| `glob` | `**/openapi.{yaml,yml,json}` | spec pattern (`**`, `*`, `?`, `{a,b}`); directories starting with a dot are skipped |
| `layout` | `flat` | folder page path: `flat` — folder name, `tree` — folder path relative to the source |

All `yaml`/`yml`/`json` files of the source are published under `<mount>/_specs/…` with
their relative layout, so relative `$ref`s keep working. Archive download fails with
`self-signed certificate in certificate chain` behind a TLS-intercepting proxy → set
`NODE_EXTRA_CA_CERTS` to the proxy CA bundle.

## `figma` — Figma frames as a site section and embeds in pages

One page per frame listed in the options (a live `embed.figma.com` iframe with an
`Open in Figma` link above it) plus a summary in list order. `name` with `/` nests
(`Mobile/Login`; spaces around `/` are trimmed, so `Mobile / Login` is the same page); a name
segment that is empty, `.`, `..` or contains `#`, `?` or `\` fails before the build. `url` is the Figma "Share" link
`https://www.figma.com/<design|file|proto|board|slides|deck>/<key>/<name>?node-id=…`; it is
normalised at load (`file` → `design`, only `node-id` kept), and a non-Figma link or a duplicate
name fails before the build. `frames` is optional. An image link to Figma on a line of its own
(`![Screen](https://www.figma.com/design/…?node-id=…)`) in any page — including OpenSpec
artifacts when `figma` comes after `openspec` in `plugins` — becomes the same `Open in Figma` link
plus iframe; inline it becomes a plain link, code blocks are untouched. No `executeScript`, no assets. The build is
offline; readers need network access to Figma and view access to the file ("Anyone with the
link can view"), which the build notes with one log line.

| Option | Default | Meaning |
|---|---|---|
| `mount` | `Figma` | section name |
| `frames` | `[]` | `[{ "name", "url", "description"? }]`; empty — no section |
| `height` | `600` | iframe height in pixels |
| `embedHost` | `c4builder` | the embed's `embed-host` parameter |

## Custom plugins

A plugin is an ESM module whose default export is an object with `name` and optional
`options` (zod schema), `watchPaths`, `assets`, `requires`, `afterScan(ctx, opts)` (add
virtual pages with `ctx.addPage`, short addresses with `ctx.addRedirect(from, to)` — a repeated
short path fails the build) and `afterBuild(ctx, opts)`. See the "Writing a plugin"
section of the c4builder README for the full contract and an example.
