# Docker & CI

## Docker image

The image has everything a build needs: Node, a JRE, the PlantUML jar, fonts, D2, the BPMN, mermaid and wireflow engines with the screen template catalog. Mount the
project into `/pwd`:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder
```

Checking diagrams without installing anything:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder check src/context.puml
```

Image tags are in sync with npm tags:

| Tag | What it is |
|---|---|
| `X.Y.Z`, `sha-…` | immutable: a specific release or commit |
| `X.Y` | latest patch of a stable line |
| `latest` | latest stable release |
| `rc` | latest release candidate |
| `edge` | latest commit on `master` |
| `pr-N` | pull request builds |

For reproducible CI builds, pin `X.Y.Z`: a different PlantUML version may shift diagram layout.

The image sets `C4BUILDER_DOCKER=1`: the new-version check does not run, and `c4builder update`
prints the image update command instead of installing anything —
`docker pull ghcr.io/alfacapital-tech/c4builder:latest` (or change the pinned tag).

## Building in CI

The image can be used directly as the job image: `c4builder` is on `PATH`.

GitLab CI, checking diagrams and publishing to GitLab Pages (`.c4builder` has
`"distFolder": "public"`):

```yaml
check:
  image: ghcr.io/alfacapital-tech/c4builder:0.9.0
  script:
    - find src \( -name '*.puml' -o -name '*.d2' -o -name '*.bpmn' -o -name '*.mmd' -o -name '*wireflow.json' \) -exec c4builder check {} +

pages:
  image: ghcr.io/alfacapital-tech/c4builder:0.9.0
  script:
    - c4builder
  artifacts:
    paths: [public]
```

GitHub Actions without Docker: Node from `setup-node`, Java from `setup-java` (or let c4builder
download a JRE itself):

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: 21 }
- run: npm i -g @alfacapital-tech/c4builder
- run: c4builder
```

If the runner has no Java, c4builder downloads a JRE on the first build. To avoid downloading it
every time, cache the folder reported by `c4builder jre info` (the `cacheDir` field) and warm it
up with `c4builder jre install` on a cache miss.

### Warm start: the render cache between jobs

Every job starts from a fresh clone and renders all diagrams again — minutes on a large project.
The render cache is portable: keep the output folder (`distFolder`) and `.c4builder.cache` between
jobs, and the next build renders only the changed diagrams, taking the rest from the previous
output (`processed N images` in the log, no Java started). Conditions: the same c4builder version
(the PlantUML and engine versions are part of the checksums) and the same font mode. Put the
package version or the lock file into the cache key so that a c4builder upgrade does not serve old
images.

GitLab CI:

```yaml
pages:
  image: ghcr.io/alfacapital-tech/c4builder:0.9.0
  cache:
    key: c4builder-$CI_COMMIT_REF_SLUG
    paths: [public, .c4builder.cache]
  script:
    - c4builder
  artifacts:
    paths: [public]
```

GitHub Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      docs
      .c4builder.cache
    key: c4builder-${{ hashFiles('package-lock.json') }}-${{ github.sha }}
    restore-keys: c4builder-${{ hashFiles('package-lock.json') }}-
- run: c4builder
```

`C4BUILDER_RENDER_CONCURRENCY` sets the number of parallel PlantUML processes (default
`min(4, CPU − 1)`): raise it on a runner with many cores and plenty of memory, lower it to `1` on
a weak one. The output does not depend on it.

In CI the background new-version check turns itself off by the `CI` variable: no process, no
registry requests, a build without internet takes as long as before.

The build behaves in CI just like locally: the exit code is not 0 if even one diagram fails to
render. A separate quick `c4builder check` step on changed files reports a clear error before the
full build.

## How this site is built

The `.github/workflows/pages.yml` workflow in the c4builder repository builds the CLI from the
same commit, then `docs/ru` and `docs/en` as two separate projects, puts them together with the
landing page into one artifact and publishes it to GitHub Pages from `master` only. On pull
requests the site is built but not published — a broken diagram in the docs shows up before the
merge.
