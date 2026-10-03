# Plugins

Plugins add content from outside `rootFolder` to the build — virtual pages — and site assets.
Virtual pages go through the regular pipeline: sidebar, search, markdown per folder, the single
file, local diagram rendering.

Plugins are listed in `.c4builder` under the `plugins` key — either as `"name"` or as
`["name", { ...options }]`:

```json
{
  "plugins": [
    "openspec",
    ["openapi", { "dir": "../contracts", "glob": "*/openapi.yaml" }]
  ]
}
```

A plugin identifier resolves in this order: a built-in name (`openspec`, `openapi`) → a local
ESM module (`./plugins/my.mjs`, `../shared/plugin.mjs`, an absolute path) → an npm package
resolved from the project folder.

- Options are validated by the plugin's schema **before** the build starts. Built-in plugins are
  strict: an unknown option key is an error.
- `${ENV_VAR}` in string options is replaced with the environment variable (unset — empty
  string) and is never printed. Archive URLs appear in messages without their query string, so a
  token in `?private_token=${TOKEN}` stays out of the logs.
- A malformed `plugins` entry always fails the build: it is the one key the wizard cannot repair.
- Older c4builder versions ignore the `plugins` key, so rolling back does not break the build.

## `openspec` — a design log on the site

Publishes an [OpenSpec](https://github.com/Fission-AI/OpenSpec) store as a site section: a
summary (counters, task progress), a page per active change, the specs tree and the archive. The
"Design log" section of this site is built exactly this way, from the repository's `openspec/`
folder.

- A change page shows a header (schema, dates, task progress, links to subpages) and the first
  artifact from `artifacts` — `proposal` by default, so the "why" is visible without an extra
  click. The remaining artifacts (`design`, `tasks`, then other `*.md` alphabetically) are
  subpages; spec deltas live under `specs/…` with the same folder layout.
- ```` ```plantuml ````, ```` ```puml ```` and ```` ```d2 ```` blocks inside artifacts are
  rendered by the **local** engines; nothing is sent to plantuml.com. The image name is derived
  from the block content, so inserting or reordering blocks never picks up a neighbour's cached
  image.
- A block that fails to render does not fail the build: the page gets a placeholder and the
  build prints a warning naming the artifact file.
- Relative links between artifacts point to their pages; files referenced by artifacts (images,
  notes) are copied next to the page.
- In `-w` mode the store folder is watched too.

| Option | Default | Meaning |
|---|---|---|
| `dir` | `openspec` | store folder (relative to the project folder) |
| `mount` | `OpenSpec` | section name and its path in the output |
| `artifacts` | `["proposal","design","tasks"]` | artifact order; the first one is shown on the change page |

## `openapi` — swagger-ui for a set of specs

Finds specs by `glob` in a local folder (`dir`) **or** in a `tar.gz`/`zip` archive downloaded
over HTTP (`archive` — for example, a GitLab or GitHub repository archive URL). One page per
spec, named after the spec's parent folder (after the file name for specs in the source root),
plus an index.

- All `yaml`/`yml`/`json` files of the source are copied into `<mount>/_specs/…` keeping their
  layout, so relative `$ref`s (including shared schema files that do not match `glob`) keep
  resolving.
- Pages load swagger-ui from the bundled files: no CDN, no external spec validator (the
  `validator.swagger.io` badge is off), and readers need no access to the source repository.
- The plugin turns `executeScript` on (and logs it) and adds `swagger-ui.css` and
  `swagger-ui-bundle.js` to `index.html`, so a custom `docsifyTemplate` needs no change.
- The archive is downloaded once per process and reused in `-w` mode.
- Behind a TLS-intercepting proxy the download fails with `self-signed certificate in certificate
  chain` — point `NODE_EXTRA_CA_CERTS` at the CA bundle (Node reads neither the system store nor
  `SSL_CERT_FILE`). The error message says so as well.

| Option | Default | Meaning |
|---|---|---|
| `mount` | `API` | section name |
| `dir` | — | local folder with specs (watched in `-w`) |
| `archive` | — | HTTP(S) URL of a tar.gz/zip archive |
| `subdir` | — | folder inside the archive or `dir` |
| `headers` | — | HTTP headers for the archive request; empty values are dropped |
| `glob` | `**/openapi.{yaml,yml,json}` | spec pattern (`**`, `*`, `?`, `{a,b}`) |

Example: the OpenSpec store sits next to the C4 sources, and contracts come from another
repository. An empty `GITLAB_TOKEN` drops the header, so the same config works with and without a
token:

```json
{
  "plugins": [
    "openspec",
    ["openapi", {
      "archive": "https://gitlab.example.com/api/v4/projects/123/repository/archive.tar.gz?sha=main",
      "glob": "*/openapi.yaml",
      "headers": { "PRIVATE-TOKEN": "${GITLAB_TOKEN}" }
    }]
  ]
}
```

## Writing a plugin

A plugin is an ESM module whose default export is a plain object. For typing, use
`definePlugin` from `@alfacapital-tech/c4builder/dist/core/plugins/types.js`.

```js
import { z } from 'zod';
export default {
  name: 'changelog',
  options: z.object({ file: z.string().default('CHANGELOG.md') }).strict(), // optional
  watchPaths: (opts) => [opts.file],                                          // optional
  assets: { styles: ['/abs/path/x.css'], scripts: ['/abs/path/x.js'] },      // optional
  requires: { executeScript: true },                                          // optional
  async afterScan(ctx, opts) {
    // ctx.tree, ctx.options — the build tree and options; ctx.source({ dir } | { archive, subdir, headers })
    // resolves a source folder; ctx.addPage adds a virtual page
    // (missing parents become index pages).
    ctx.addPage({
      path: ['Changelog'],
      markdown: '## Latest\n\n![flow](flow.puml)',
      diagrams: [{ file: 'flow.puml', content: '@startuml\nA -> B\n@enduml' }]
    });
  },
  async afterBuild(ctx, opts) { /* ctx.distFolder, ctx.options — copy extra files, check the output */ }
};
```

Hooks run in the order of the `plugins` list. An exception in a hook aborts the build with the
plugin's name; the copy of the previous output is kept. A virtual page path cannot coincide with
a real source folder — the build stops and asks you to rename the `mount`.
