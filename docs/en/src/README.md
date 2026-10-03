# C4-Builder

**Architecture as code that an agent writes, checks and reads.**

C4-Builder is a CLI that builds a folder of markdown files and PlantUML or D2 diagrams into
documentation: a docsify site, a markdown file per folder, or a single file. Folders define the
hierarchy of the [C4 model](https://c4model.com/) (system → container → component), and git
keeps the history of architecture decisions next to the code: a change to the architecture is
reviewed in a pull request like any other change.

This site is built by c4builder itself from the `docs/` folder of the repository; its diagrams
are rendered during the CI build.

![C4-Builder context](context.puml)

## How this fork differs from upstream

The original C4-Builder is no longer developed: its last commit dates from March 2024, and the
last npm release of `c4builder` (0.2.16) is from 2022. At Alfa-Capital it builds an architecture
repository of more than a hundred diagrams, so we continue it as a maintained fork and adapt it
to working with AI agents:

- **Deterministic offline rendering.** The PlantUML jar, the font and the engines ship with the
  package, layout is computed by Smetana (the engine built into PlantUML), Graphviz is not
  needed. The same sources produce the same SVG on a laptop, in CI and in Docker, and the build
  needs no network.
- **`c4builder check` gives feedback in seconds.** It checks individual diagrams with the same
  engine as the build and returns an exit code and the line of the error. An agent edits a
  `.puml` and immediately knows whether it broke something — without a human and without a full
  build.
- **Plugins.** `openspec` publishes specs and changes next to the C4 model, `openapi` publishes
  service contracts as offline swagger-ui pages.
- **D2** as a second diagram engine, PNG via resvg, Java is optional: c4builder downloads a JRE
  if there is none.
- **Engineering basics.** TypeScript, golden snapshots of the rendering, CI on every pull
  request, an npm package and a Docker image per release tag.

The full list of changes is in the
[CHANGELOG](https://github.com/AlfaCapital-Tech/C4-Builder/blob/master/CHANGELOG.md).

## The agent loop

1. An agent (or you) edits `.md` and `.puml` files in `src/`.
2. `c4builder check <files>` tells whether the diagram compiles and shows the line of the error.
3. `c4builder --site -w` rebuilds the site on every save and reloads the browser.

More on the [Agents](08%20Agents/08%20Agents.md) page.

## Sections

- [Getting started](01%20Getting%20started/01%20Getting%20started.md) — installation and the first project.
- [Project](02%20Project/02%20Project.md) — how folders and files become pages.
- [Diagrams](03%20Diagrams/03%20Diagrams.md) — PlantUML, D2, fonts, PNG, checking.
- [Outputs](04%20Outputs/04%20Outputs.md) — site, markdown per folder, single file.
- [CLI & configuration](05%20CLI%20and%20configuration/05%20CLI%20and%20configuration.md) —
  commands and `.c4builder` keys.
- [Plugins](06%20Plugins/06%20Plugins.md) — `openspec`, `openapi`, writing your own.
- [Docker & CI](07%20Docker%20and%20CI/07%20Docker%20and%20CI.md) — the image and pipeline builds.
- [Development](09%20Development/09%20Development.md) — how c4builder is built and released.
- **Design log** — the OpenSpec store of this repository: why c4builder works the way it does.

> **The Design log is in Russian.** Its pages are the project's own OpenSpec artifacts
> (proposals, designs, specs, tasks), which the team writes in Russian; they are published as
> they are, without translation. Code, identifiers and commands in them are in English.

## Credits

C4-Builder was created by Adrian Victor Lupu and is distributed under the MIT license. The fork
keeps the license, the authorship and the history: upstream changes with links to their
original pull requests are listed in the CHANGELOG.
