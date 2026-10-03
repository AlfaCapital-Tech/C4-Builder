# Docker & CI

## Docker image

The image has everything a build needs: Node, a JRE, the PlantUML jar, fonts, D2 and the BPMN engine. Mount the
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

## Building in CI

The image can be used directly as the job image: `c4builder` is on `PATH`.

GitLab CI, checking diagrams and publishing to GitLab Pages (`.c4builder` has
`"distFolder": "public"`):

```yaml
check:
  image: ghcr.io/alfacapital-tech/c4builder:0.4.0
  script:
    - find src \( -name '*.puml' -o -name '*.d2' -o -name '*.bpmn' \) -exec c4builder check {} +

pages:
  image: ghcr.io/alfacapital-tech/c4builder:0.4.0
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

The build behaves in CI just like locally: the exit code is not 0 if even one diagram fails to
render. A separate quick `c4builder check` step on changed files reports a clear error before the
full build.

## How this site is built

The `.github/workflows/pages.yml` workflow in the c4builder repository builds the CLI from the
same commit, then `docs/ru` and `docs/en` as two separate projects, puts them together with the
landing page into one artifact and publishes it to GitHub Pages from `master` only. On pull
requests the site is built but not published — a broken diagram in the docs shows up before the
merge.
