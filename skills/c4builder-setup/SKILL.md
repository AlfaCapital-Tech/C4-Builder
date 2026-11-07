---
name: c4builder-setup
description: Install, update and diagnose c4builder (npm package @alfacapital-tech/c4builder), the CLI that builds C4 / PlantUML / D2 architecture docs into a docsify site or markdown, and install its agent skills into a project. Use when asked to install or upgrade c4builder, when the c4builder command is missing or fails to render diagrams, when switching between the stable and release-candidate channels, or when onboarding onto a repository documented with c4builder. Optional argument - channel rc; default is the stable latest. Idempotent - a re-run only verifies.
---

# c4builder setup

Goal: a `c4builder` that really renders diagrams, and its skills in the working project.
`c4builder --version` alone proves nothing — the smoke build (step 5) does.

**Channel.** `latest` — stable (default); `rc` — release candidates (`X.Y.Z-rc.N`). npm
dist-tags and Docker image tags carry the same names.

Every step: check → fix only what is broken.

## 1. Diagnose

```bash
c4builder doctor
```

It only reads: Node.js against `engines`, the CLI version and a newer release, how c4builder is
installed, Java, the D2 engine, fonts, proxy variables (only whether they are set), the agent
skills, a tiny C4 render, the project's `.c4builder` and the port. Each problem has a line
`fix: <command or link>` under it; `(ask the user first)` marks fixes that change project files or
remove personal copies. Apply the fixes with the steps below, then run `c4builder doctor` again.
Exit code 1 — an error is left; warnings keep it 0 (`--strict` makes them 1 too).

`c4builder doctor --json` prints the same as one JSON object with stable check ids (`env.node`,
`env.java`, `skills.claude.project`, …); `-v` adds paths and details. `c4builder doctor env skills`
runs only these groups. `c4builder: command not found` → no CLI yet: start with step 3.

## 2. Node.js and the version

`env.node` error → Node.js is older than the package needs. Agree with the user on how to
install a current LTS (nvm, OS package manager, official installer); do not pick a method
silently. Docker users skip to step 3.

`env.update` warns about a newer release → `c4builder update` (step 3). `env.update` skipped
with `registry not reachable` → the public registry may be closed in this network:

```bash
npm view @alfacapital-tech/c4builder dist-tags
```

An organization mirror is configured in the user's npmrc (`npm config get registry` shows the
current one) or passed per command with `--registry <url>`; ask the user for the address, never
guess one. The update check of c4builder, `c4builder update` and `c4builder doctor` use the same
npmrc.

Installed version is **newer** than the requested channel (an `rc` while `latest` was
asked for) → that is a downgrade: never do it silently, confirm with the user — they
probably want the `rc` channel.

## 3. Install / update

```bash
npm install -g @alfacapital-tech/c4builder@latest   # stable
npm install -g @alfacapital-tech/c4builder@rc       # release candidate
```

- An installed global CLI is updated with `c4builder update`: it installs the newest version
  (`latest`; on a release candidate the newer of `latest` and `rc`). For a project dependency
  or the Docker image it installs nothing and prints the command to use instead. Switching the
  channel is the `npm install -g` line above.
- Do not pass `--omit=optional`: the D2 engine (`@terrastruct/d2`) is an optional
  dependency; without it a project with `.d2` files stops with an install hint (`env.d2` error).
- `c4builder: command not found` after a successful install → the global npm bin folder
  is not on `PATH` (`npm prefix -g` shows the prefix; the binary lives in its `bin`).
  `env.install` warns about several `c4builder` on `PATH` → the first one runs; `-v` lists them.

**Docker instead of npm** — the image ships Node, a JRE, the PlantUML jar, fonts and D2,
so steps 2 and 4 are not needed. Mount the project into `/pwd`:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder
```

Image tags: `latest`, `rc`, `X.Y.Z`, `edge` (last master commit). The same image works as a
CI job image — `c4builder` is on `PATH`, so `c4builder doctor` runs inside it too. To show
diagram errors in the PR/MR diff, run `c4builder check --strict --format github <files>`
(GitHub Actions annotations) or `--format gitlab <files> > gl-code-quality-report.json` with
`artifacts: { when: always, reports: { codequality: gl-code-quality-report.json } }` (GitLab Code
Quality); without files both print an empty report and exit 0. Pass the changed files as
`git -c core.quotePath=false diff --name-only … | c4builder check --format … --files-from -`
(one path per line, `-` is stdin), not through `xargs`: it may split the list into several
calls, and the report would be several JSON arrays. `--format` and `--files-from` need
c4builder 0.15.0+ (pin `@alfacapital-tech/c4builder@0.15.0` or the `0.15.0` image tag); the
image has no `git`, so a diff-based job runs on `node:24` with the npm package. Ready jobs:
the site page "Docker and CI".

## 4. Java for PlantUML

Diagrams are rendered by the bundled PlantUML jar → Java 17+ is needed (`JAVA_HOME` is
checked first, then `PATH`). Graphviz is **not** needed. `env.java` warns when there is
neither a system Java 17+ nor a managed JRE; doctor itself never downloads one:

```bash
c4builder jre install
```

It reports a suitable system java and stops; otherwise it downloads a private Temurin JRE into
the user cache once — tell the user it did. A broken system java (`render.plantuml` error) can be
bypassed with `c4builder jre install --force` (downloads even when java is present).
`c4builder jre info` prints the managed JRE parameters as JSON (Temurin major, cache
folder) — use it to key a CI cache.

Download fails with a certificate error (TLS-intercepting proxy) → set
`NODE_EXTRA_CA_CERTS` to the proxy's CA bundle; Node reads neither the system store nor
`SSL_CERT_FILE`. `env.proxy` warns when it points to a missing file.

## 5. Smoke build

```bash
c4builder doctor render --full
```

It creates the bundled template project in a temporary folder, builds it with the installed
CLI and removes the folder whatever the outcome. `render.full` ok → Node, CLI, Java/PlantUML
and the site generator work. Error → the tail of the build log is printed under it: read it,
return to step 4 (Java) or step 3 (D2 hint). Skipped → no Java, step 4. The build log of a
successful run is shown with `-v`.

## 6. Skills in the working project

In the root of the user's project (not the temporary one):

```bash
c4builder skills
```

It installs the skills of the installed CLI version into `.agents/skills/` (and `.claude/skills/`
under Claude Code or when `.claude/` exists), replacing only the c4builder skills there; each
installed `SKILL.md` carries `metadata.generatedBy: <version>`. These are files in the user's
repository — run it when the user asked for the setup of this project, otherwise ask first.
`c4builder doctor skills` shows what is installed where: missing, outdated or edited copies, a
stale personal copy that shadows the project skills (for example from `npx skills add -g`; remove
it only with the user's consent) and copies in Claude Code plugins (informational, no fix). A
project created with `c4builder --new` already has the skills.

## Report

The output of `c4builder doctor` (without `-v`: it shows the home folder as `~` and no variable
values, safe to paste into an issue) and what was fixed. For working on the diagrams themselves,
use the `c4builder` skill.
