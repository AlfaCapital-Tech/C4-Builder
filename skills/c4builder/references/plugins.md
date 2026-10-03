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
- Name resolution: built-in (`openspec`, `openapi`) → local ESM module
  (`./plugins/my.mjs`, relative to the project) → npm package installed in the project.
- Options are validated before the build; built-in plugins reject unknown option keys.
- `${ENV_VAR}` inside string options is replaced from the environment (unset → empty) and
  never printed — keep tokens there, not in the file.
- Plugin folders are watched by `c4builder --site -w`.
- Hooks run in list order; an exception aborts the build and names the plugin.

## `openspec` — OpenSpec store as a site section

Renders an [OpenSpec](https://github.com/Fission-AI/OpenSpec) store: a summary page
(counters, task progress), one page per active change (header + first artifact, the other
artifacts and spec deltas as subpages), the specs tree and the archive. `plantuml` / `d2`
fenced blocks in artifacts are rendered by the local engines; a broken block gets a
placeholder image and a warning naming the file instead of failing the build.

| Option | Default | Meaning |
|---|---|---|
| `dir` | `openspec` | store folder, relative to the project |
| `mount` | `OpenSpec` | section name and its path in the output |
| `artifacts` | `["proposal", "design", "tasks"]` | artifact order; the first is shown on the change page |

## `openapi` — swagger-ui pages for OpenAPI specs

One page per spec found by `glob` (named after the spec's parent folder) plus an index;
swagger-ui is bundled, readers need no network. Exactly one source — `dir` **or**
`archive` — is required. It forces `executeScript: true`.

| Option | Default | Meaning |
|---|---|---|
| `mount` | `API` | section name |
| `dir` | — | local folder with specs (watched) |
| `archive` | — | HTTP(S) URL of a `tar.gz` / `zip` archive (e.g. a repository archive) |
| `subdir` | — | folder inside the archive or `dir` |
| `headers` | — | HTTP headers for the archive request, e.g. `{"PRIVATE-TOKEN": "${GITLAB_TOKEN}"}` |
| `glob` | `**/openapi.{yaml,yml,json}` | spec pattern (`**`, `*`, `?`, `{a,b}`) |

All `yaml`/`yml`/`json` files of the source are published under `<mount>/_specs/…` with
their relative layout, so relative `$ref`s keep working. Archive download fails with
`self-signed certificate in certificate chain` behind a TLS-intercepting proxy → set
`NODE_EXTRA_CA_CERTS` to the proxy CA bundle.

## Custom plugins

A plugin is an ESM module whose default export is an object with `name` and optional
`options` (zod schema), `watchPaths`, `assets`, `requires`, `afterScan(ctx, opts)` (add
virtual pages with `ctx.addPage`) and `afterBuild(ctx, opts)`. See the "Writing a plugin"
section of the c4builder README for the full contract and an example.
