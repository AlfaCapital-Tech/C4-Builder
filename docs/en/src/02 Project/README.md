# Project

A c4builder project is a folder with a `.c4builder` file. It has two main folders: the
**sources** (`src`, key `rootFolder`) and the **output** (`docs`, key `distFolder`). Run every
command from the project folder: paths in the config are relative to it.

## Folder = page

Every folder inside the sources is one documentation page. Following the C4 model, it is usually
a system, a container or a component, but any topic works: ADRs, a glossary, a runbook.

```text
demo/
├── .c4builder              project config
├── docs/                   output: recreated on every build
└── src/                    sources
    ├── context.md          root = home page
    ├── context.puml
    ├── styles.iuml         shared diagram theme (pulled in with !include)
    └── 1 Internet Banking System/
        ├── system.md
        ├── system.puml
        └── API Application/
            ├── container.md
            └── container.puml
```

The build walks the tree and merges all `.md` files and diagrams of a folder into one page:

- **Page title** — the folder name. If the first `.md` starts with its own `# Heading`, that
  heading is used instead.
- **Page order** — file system order. To set it explicitly, use numeric prefixes:
  `1 Context`, `2 Containers`. The prefix is visible in the sidebar title.
- **Diagrams** are inserted as images. By default they go before the page text; with
  `diagramsOnTop: false`, after it.
- **A diagram can be placed anywhere in the text** by linking to its source:
  `![containers](container.puml)`. Such a diagram is not repeated in the common block.
- **Files and folders prefixed with `_`** do not become pages and are not rendered on their own,
  but they are available to `!include` and D2 imports. This is the place for shared libraries:
  `_c4lib.d2`, `_common.iuml`.
- **Other files** (images, attachments) are copied to the output next to the page unless
  `excludeOtherFiles` is on. Put an image next to the `.md` that references it.

## Service files

| File | Purpose | In git |
|---|---|---|
| `.c4builder` | project config | yes |
| `.c4builder.cache` | diagram checksums: unchanged diagrams are not rendered again | no |
| `.c4builder.lock` | build lock: two builds in one folder never write the output at the same time | no |
| `docs_bk/` | copy of the previous output during a build; kept as a fallback if the build fails | no |

c4builder deletes and recreates the output folder on every build, so do not keep your own files
there. Whether to commit the output depends on the format: markdown per folder is convenient to
keep in the repository, a site is usually built in CI.
