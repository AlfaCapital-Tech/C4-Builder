---
name: c4builder-setup
description: Install, update and diagnose c4builder (npm package @alfacapital-tech/c4builder), the CLI that builds C4 / PlantUML / D2 architecture docs into a docsify site or markdown. Use when asked to install or upgrade c4builder, when the c4builder command is missing or fails to render diagrams, when switching between the stable and release-candidate channels, or when onboarding onto a repository documented with c4builder. Optional argument - channel rc; default is the stable latest. Idempotent - a re-run only verifies.
---

# c4builder setup

Goal: a `c4builder` that really renders diagrams. `c4builder --version` alone proves
nothing — finish with the smoke build (step 5).

**Channel.** `latest` — stable (default); `rc` — release candidates (`X.Y.Z-rc.N`). npm
dist-tags and Docker image tags carry the same names.

Every step: check → fix only what is broken.

## 1. Node.js

```bash
node --version   # needs >= 20.19
```

Missing or older → agree with the user on how to install a current LTS (nvm, OS package
manager, official installer); do not pick a method silently. Docker users skip to step 3.

## 2. Installed version vs. channel

```bash
c4builder --version
npm view @alfacapital-tech/c4builder dist-tags
```

Installed version equals the channel's tag → skip step 3.
Installed version is **newer** than the requested channel (an `rc` while `latest` was
asked for) → that is a downgrade: never do it silently, confirm with the user — they
probably want the `rc` channel.

## 3. Install / update

```bash
npm install -g @alfacapital-tech/c4builder@latest   # stable
npm install -g @alfacapital-tech/c4builder@rc       # release candidate
```

- Do not pass `--omit=optional`: the D2 engine (`@terrastruct/d2`) is an optional
  dependency; without it a project with `.d2` files stops with an install hint.
- `c4builder: command not found` after a successful install → the global npm bin folder
  is not on `PATH` (`npm prefix -g` shows the prefix; the binary lives in its `bin`).

**Docker instead of npm** — the image ships Node, a JRE, the PlantUML jar, fonts and D2,
so steps 1 and 4 are not needed. Mount the project into `/pwd`:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder
```

Image tags: `latest`, `rc`, `X.Y.Z`, `edge` (last master commit). The same image works as a
CI job image — `c4builder` is on `PATH`.

## 4. Java for PlantUML

Diagrams are rendered by the bundled PlantUML jar → Java 17+ is needed (`JAVA_HOME` is
checked first, then `PATH`). Graphviz is **not** needed.

```bash
java -version
c4builder jre install
```

`c4builder jre install` reports a suitable system java and stops; otherwise it downloads a
private Temurin JRE into the user cache once — tell the user it did. A broken system java
can be bypassed with `c4builder jre install --force` (downloads even when java is present).
`c4builder jre info` prints the managed JRE parameters as JSON (Temurin major, cache
folder) — use it to key a CI cache.

Download fails with a certificate error (TLS-intercepting proxy) → set
`NODE_EXTRA_CA_CERTS` to the proxy's CA bundle; Node reads neither the system store nor
`SSL_CERT_FILE`.

## 5. Smoke build

Build the bundled template project in a temporary folder:

```bash
cd "$(mktemp -d)"
c4builder --new --name smoke -y
cd smoke
c4builder
ls docs/index.html docs/context.svg
```

`--new --name smoke -y` creates the project with default settings and no prompts; the
plain `c4builder` run is a one-off build. Both files listed → Node, CLI, Java/PlantUML and
the site generator work. `index.html` without `context.svg`, or a non-zero exit code →
rendering problem: read the error, return to step 4 (Java) or step 3 (D2 hint). Remove the
temporary folder afterwards.

With Docker, run the same two commands through the image: `c4builder --new --name smoke -y`
in the temporary folder, then the plain build with `smoke` mounted as `/pwd`.

## Report

One short summary: Node version / c4builder version and channel / Java (system or managed
JRE) / smoke build — each OK or fixed. For working on the diagrams themselves, use the
`c4builder` skill.
