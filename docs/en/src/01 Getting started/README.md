# Getting started

## Installation

```bash
npm i -g @alfacapital-tech/c4builder
```

Node.js 20.19 or newer is required. `npm install` without a tag installs the latest stable
release.

Rendering PlantUML needs Java 17+. If `java` is available in `JAVA_HOME` or on `PATH`, c4builder
uses it; otherwise the first build downloads a private JRE (Temurin) into its cache. Graphviz is
not needed: layout is computed by Smetana, the engine built into PlantUML. The PlantUML jar and
the diagram font are part of the package.

```bash
c4builder jre info      # which Java will be used (JSON: version, cache path)
c4builder jre install   # download the JRE in advance: before going offline or into a CI image
```

If you would rather not install Node and Java, use the
[Docker image](07%20Docker%20and%20CI/07%20Docker%20and%20CI.md) — it has everything.

## First project

```bash
c4builder new --name demo -y   # project from the template with a full config, no questions
cd demo
c4builder                      # build into docs/
c4builder site                 # site at http://localhost:3000
```

Without `-y`, `new` asks for the project name, and the first build walks you through the setup
wizard. The `--new` flag is the same as `new`.

The new project contains the "Internet Banking System" demo from the C4 model: context,
containers, deployment, a dynamic diagram, sequence, class and ditaa diagrams, a page in Cyrillic
and a D2 example. All C4 diagrams include the library through the stdlib
(`!include <C4/C4_Container>`): C4-PlantUML is built into the jar, so the build needs no
internet.

## Live preview

```bash
c4builder --site -w
```

Builds the project, starts a local server and rebuilds the site on every save in `src/`. The
browser reloads by itself and keeps the scroll position. `-o` opens the browser, `-p 8080`
changes the port.

## Changing the settings

`c4builder config` (or `--config`) runs the wizard again with the current values as defaults;
`c4builder --list` prints the config. `.c4builder` is plain JSON and can be edited by hand: every
key is described on the [CLI & configuration](05%20CLI%20and%20configuration/05%20CLI%20and%20configuration.md)
page.

## Release candidates

Pre-releases `X.Y.Z-rc.N` are published under the npm tag `rc` and never touch `latest`:

```bash
npm i -g @alfacapital-tech/c4builder@rc
```

To go back to the stable version, install the package with the `latest` tag.
