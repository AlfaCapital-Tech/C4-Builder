**[Документация на русском](https://alfacapital-tech.github.io/C4-Builder/ru/)** · [English documentation](https://alfacapital-tech.github.io/C4-Builder/en/) · [Site](https://alfacapital-tech.github.io/C4-Builder/)

# C4-Builder

**Architecture as code that an agent writes, checks and reads.**

C4-Builder is a CLI that builds a folder of markdown files and [PlantUML](https://plantuml.com/)
or [D2](https://d2lang.com/) diagrams into documentation: a [docsify](https://docsify.js.org/)
site, a markdown file per folder, or a single file. Folders follow the
[C4 model](https://c4model.com/) (system → container → component), and git keeps the history of
architecture decisions next to the code.

## Why this fork

The original [C4-Builder](https://github.com/adrianvlupu/C4-Builder) by Adrian Victor Lupu has not
been developed since March 2024. At Alfa-Capital it builds an architecture repository of more
than a hundred diagrams, so we continue it as a maintained fork, adapted to working with AI agents:

- **Deterministic offline rendering.** The PlantUML jar, the diagram font and the engines ship
  with the package; layout is computed by PlantUML's built-in Smetana engine, no Graphviz. The
  same sources produce the same SVG on a laptop, in CI and in Docker, with no network access.
- **`c4builder check`** validates individual `.puml`/`.iuml`/`.d2` files with the build's own
  engine and returns an exit code and the error line — fast feedback for agents, pre-commit
  hooks and CI.
- **Plugins.** `openspec` publishes an [OpenSpec](https://github.com/Fission-AI/OpenSpec) store
  (specs and changes) as a site section; `openapi` renders service contracts as offline
  swagger-ui pages.
- **D2** as a second diagram engine, deterministic **PNG** via resvg, and **optional Java**:
  without a system Java, c4builder downloads a private JRE.
- **Maintained.** TypeScript, golden rendering snapshots, CI on every pull request, releases to
  npm and GHCR. The PDF output of the original was removed.

## Quick start

Requires Node.js ≥ 20.19. Java 17+ is optional.

```bash
npm i -g @alfacapital-tech/c4builder

c4builder --new --name demo -y   # project from the template, full config, no prompts
cd demo
c4builder                        # build into docs/
c4builder --site -w              # live preview at http://localhost:3000
```

Since 0.5.0, `c4builder new` and `c4builder config` work too (0.4.0 has only the flags).
Without `-y`, c4builder asks for the project name and the first build runs the setup wizard.

The agent loop — edit a diagram, check it, look at the result:

```bash
c4builder check src/context.puml   # exit code 0 or 1, "✗ file: line N: message" on error
c4builder --site -w                # rebuilds and reloads the browser on every save
```

For agents: `npx skills add AlfaCapital-Tech/C4-Builder/skills` installs the skills, and
`"generateLLMS": true` adds `llms.txt` / `llms-full.txt` (diagram sources included) to the site.

Or with Docker (Node, JRE, PlantUML, fonts and D2 included):

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder
```

Release candidates are published under the `rc` tag: `npm i -g @alfacapital-tech/c4builder@rc`.

## Documentation

The full reference lives on the documentation site, in Russian (primary) and English:

| | Русский | English |
|---|---|---|
| Getting started | [Быстрый старт](https://alfacapital-tech.github.io/C4-Builder/ru/#/01%20Быстрый%20старт/01%20Быстрый%20старт) | [Getting started](https://alfacapital-tech.github.io/C4-Builder/en/#/01%20Getting%20started/01%20Getting%20started) |
| Diagrams, fonts, `check` | [Диаграммы](https://alfacapital-tech.github.io/C4-Builder/ru/#/03%20Диаграммы/03%20Диаграммы) | [Diagrams](https://alfacapital-tech.github.io/C4-Builder/en/#/03%20Diagrams/03%20Diagrams) |
| CLI and `.c4builder` keys | [CLI и конфигурация](https://alfacapital-tech.github.io/C4-Builder/ru/#/05%20CLI%20и%20конфигурация/05%20CLI%20и%20конфигурация) | [CLI & configuration](https://alfacapital-tech.github.io/C4-Builder/en/#/05%20CLI%20and%20configuration/05%20CLI%20and%20configuration) |
| Plugins | [Плагины](https://alfacapital-tech.github.io/C4-Builder/ru/#/06%20Плагины/06%20Плагины) | [Plugins](https://alfacapital-tech.github.io/C4-Builder/en/#/06%20Plugins/06%20Plugins) |
| Docker and CI | [Docker и CI](https://alfacapital-tech.github.io/C4-Builder/ru/#/07%20Docker%20и%20CI/07%20Docker%20и%20CI) | [Docker & CI](https://alfacapital-tech.github.io/C4-Builder/en/#/07%20Docker%20and%20CI/07%20Docker%20and%20CI) |
| Working with agents | [Агенты](https://alfacapital-tech.github.io/C4-Builder/ru/#/08%20Агенты/08%20Агенты) | [Agents](https://alfacapital-tech.github.io/C4-Builder/en/#/08%20Agents/08%20Agents) |
| Development and releases | [Разработка](https://alfacapital-tech.github.io/C4-Builder/ru/#/09%20Разработка/09%20Разработка) | [Development](https://alfacapital-tech.github.io/C4-Builder/en/#/09%20Development/09%20Development) |

What changed in each version: [CHANGELOG.md](https://github.com/AlfaCapital-Tech/C4-Builder/blob/master/CHANGELOG.md).
Why things are the way they are: the design log (OpenSpec store) on the site.

## Contributing

```bash
npm ci && npm run build
npm test            # all tests, golden rendering snapshots included
npm run check       # biome lint and format
```

Behaviour changes are described in OpenSpec (`openspec/changes/`) first, add a line to
`## Unreleased` in `CHANGELOG.md` and update the documentation pages in both languages
(`docs/ru/src`, `docs/en/src`). Details are on the Development page.

## Credits and license

C4-Builder was created by [Adrian Victor Lupu](https://github.com/adrianvlupu/C4-Builder); this
fork is maintained by [Alfa Capital Technologies](https://alfacapital.tech). Upstream changes and
their contributors are listed in the changelog. MIT license, see
[license](https://github.com/AlfaCapital-Tech/C4-Builder/blob/master/license).
