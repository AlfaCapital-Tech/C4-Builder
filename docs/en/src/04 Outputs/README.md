# Outputs

Output formats are switched on independently, in any combination: the wizard asks about them on
the first build, and in `.c4builder` they are `generateMD`, `generateCompleteMD` and
`generateWEB`. The output mirrors the structure of the sources.

## Docsify site

`generateWEB: true` (default). The output gets an `index.html`, a sidebar with the page hierarchy
and one `.md` per page. The site is static and does not go to the internet: docsify, the theme
and the plugins sit in `vendor/` next to `index.html`, diagrams are ready-made SVG or PNG files.

- To view it locally, run `c4builder site` (or `--site -w` to rebuild on changes), by default at
  `http://localhost:3000`. Double-clicking `index.html` will not work: docsify loads pages with
  requests and needs an HTTP server.
- To publish it, copy the output folder to any static hosting: GitHub Pages, GitLab Pages,
  nginx. The build writes `.nojekyll` so GitHub Pages does not hide files starting with `_`.
- Site search is `supportSearch`, the repository link in the corner is `repoUrl`, a custom theme
  is `webTheme`, a custom `index.html` template is `docsifyTemplate`.

This site is an example of such an output: see [Docker & CI](07%20Docker%20and%20CI/07%20Docker%20and%20CI.md)
for how it is built.

## Markdown per folder

`generateMD: true` (default). Each output folder gets a `README.md` with all the text and
diagrams of the page. This output is convenient to commit: GitHub and GitLab render it as regular
repository documentation.

Navigation at the top of each file:

- `includeTableOfContents` (default) — the tree of all pages with the current one highlighted;
- `includeNavigation` — a link to the parent and a list of child pages.

## Single file

`generateCompleteMD: true` puts everything into `<projectName>.md` at the output root: a table of
contents followed by a section per page, each with a link back to the top. It works as a single
architecture README or as input for tools that read one file.

## How diagrams appear

| Key | What it changes |
|---|---|
| `diagramsOnTop` | diagrams not placed in the text explicitly go before the text (default) or after it |
| `includeLinkToDiagram` | a link to the diagram file instead of the image |
| `embedDiagram` | the image is embedded into markdown as a base64 string, with a download link next to it |
| `includeBreadcrumbs` | the page's path in the tree under its title |
| `excludeOtherFiles` | do not copy images and other files from the sources to the output |
| `diagramFormat` | `svg` (default) or `png` |
