# Development

This page is for those who change c4builder itself. Repository:
[AlfaCapital-Tech/C4-Builder](https://github.com/AlfaCapital-Tech/C4-Builder).

## How it works

![C4-Builder containers](container.puml)

The build runs in phases: **scan** walks `src/` and builds the page tree, **plugins** add virtual
pages to it, **render** renders the diagrams (with a checksum cache), **compose** writes markdown,
the sidebar and `index.html`. The CLI is a thin layer on top: argument parsing, the wizard, and
the separate `check` and `jre` commands. Everything that affects the rendering result (the
PlantUML jar, fonts, docsify, swagger-ui) lives in `vendor/` and is not edited by hand.

## Build and tests

```bash
npm ci
npm run build          # tsc → dist/
npm test               # all tests, including golden
npm run test:unit      # without golden: fast and Java-free
npm run check          # biome: lint and format
```

TypeScript, ESM, Node 20.19+. The tests run the built CLI from `dist/`, so `npm test` compiles
first.

**Golden snapshots.** `test/golden.test.mjs` builds the `template/src` template in several
configurations and compares the whole output with the reference in `test/golden/` —
byte-for-byte, SVG included. Rendering is pinned to a specific JRE (Temurin), which the test
downloads into the cache itself. Changed the rendering or the template? Regenerate the references
with `npm run test:golden:update` and include the `test/golden/` diff in the pull request. On some
Linux distributions the SVGs differ because of the system fontconfig; in CI on Ubuntu the
reference is stable.

**Documentation site.** Sources are in `docs/ru/src` and `docs/en/src`, the landing page in
`docs/landing`. The `test/docs-parity.test.mjs` test checks that RU and EN have the same set of
pages: folders are matched by numeric prefix, files by name. Local preview:

```bash
npm run build
cd docs/en && node ../../dist/index.js --site -w
```

## Process: OpenSpec

Behaviour changes are first described in [OpenSpec](https://github.com/Fission-AI/OpenSpec):
`openspec/changes/<name>/` holds the proposal (why), the design (how and why this way), specs
(requirements with scenarios) and tasks. After implementation the change is archived and its
requirements move to `openspec/specs/`. Artifacts are written in Russian; code and identifiers in
English.

The whole store is published on this site in the **Design log** section: active changes, specs
and the archive — the offline template, dropping Graphviz, local D2 and PNG rendering, the move
to TypeScript, the plugin system. Its pages are in Russian.

## Changelog

Every user-facing change (a feature, a fix, CLI behaviour) adds a line to the `## Unreleased`
section of [CHANGELOG.md](https://github.com/AlfaCapital-Tech/C4-Builder/blob/master/CHANGELOG.md)
in the same pull request. If behaviour changes, the page on this site is updated too — in both
language versions.

## Releases

Only pushing a git tag `v<version>` publishes anything. A merge to `master` publishes nothing
except the `edge` Docker tag and an update of this site.

**Release candidate** — from `master`, as many as needed; whoever follows `rc` gets each one:

```bash
npm version X.Y.Z-rc.1 -m "rc: %s"      # first candidate
npm version prerelease -m "rc: %s"      # next ones: rc.2, rc.3, …
git push --follow-tags
```

Publishes to the npm tag `rc` and the Docker tag `rc`; `latest` is untouched.

**Final release** — first rename `## Unreleased` to `## vX.Y.Z` in `CHANGELOG.md`:

```bash
npm version X.Y.Z -m "release: %s"
git push --follow-tags
```

Publishes to the npm tag `latest` and the Docker tags `X.Y.Z`, `X.Y`, `latest`. npm is published
via OIDC (trusted publishing) with provenance, the image goes to GHCR.
