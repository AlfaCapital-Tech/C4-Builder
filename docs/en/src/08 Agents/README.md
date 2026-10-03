# Agents

An agent edits a C4 model in text form as confidently as code: `Person`, `System`, `Container`
and `Rel` in a `.puml` are a ready-made semantic model, not a picture. What it usually lacks is
something else: a fast, unambiguous answer to "did I break it?". c4builder gives that answer
locally, without a network and without a human.

## The edit → check → build loop

1. **Edit.** The agent changes `.md` and `.puml`/`.d2` files in `src/` — adds a container, a
   relationship, a page.
2. **Check.** `c4builder check` on the changed files:

   ```bash
   c4builder check "src/1 Internet Banking System/system.puml"
   ```

   Exit code 0 — everything compiles. Exit code 1 — the output has a line with the file and the
   line number (`строка` is Russian for "line"):

   ```text
   ✗ src/1 Internet Banking System/system.puml: строка 12: Fatal parsing error
   ```

   The check uses the same engine and the same `!include`s as the build and takes seconds: the
   agent fixes the error and repeats until it gets 0.
3. **Build.** `c4builder` builds the whole project; `c4builder --site -w` keeps the site open for
   the human and rebuilds it on every save the agent makes.

A full build also exits with a non-zero code if any diagram fails to render, so it can be the
agent's last step or a CI step.

## Why offline rendering matters for agents

- **No network, no random failures.** The PlantUML jar, the C4 library, the font and D2 ship with
  the package; the build does not depend on plantuml.com, proxies or rate limits.
- **Same input, same output.** The bundled font and pinned engine versions give identical SVG on
  any machine. The pull request diff shows what the agent changed in the model, not
  environmental noise.
- **Sources stay inside.** Architecture often contains things that do not belong on someone
  else's server; local rendering rules that out.

## Agent skills

c4builder ships [Agent Skills](https://agentskills.io) for Claude Code, Codex, Cursor and the other
agents supported by the [`skills`](https://github.com/vercel-labs/skills) CLI. The skills live in
the `skills/` folder of the repository (they are not part of the npm package) and describe the
latest stable release, so their commands use the flags: `--new`, `--config`.

```bash
npx skills add AlfaCapital-Tech/C4-Builder/skills                    # both skills into the current project
npx skills add AlfaCapital-Tech/C4-Builder/skills --skill c4builder  # just one
```

`-g` installs the skills for the user instead of the project. The `/skills` path in the command
matters: without it the CLI also picks up the internal development skills of c4builder itself
from `.claude/skills/`.

| Skill | Use it for |
|---|---|
| `c4builder` | working on a project: layout of `src/` and `.c4builder`, the edit → `c4builder check` → build loop, C4-PlantUML conventions (stdlib includes, shared `.iuml`, offline rendering), D2, the `openspec` and `openapi` plugins, `llms.txt` |
| `c4builder-setup` | install and update (npm channels `latest` and `rc`, the Docker image), Java or the downloaded JRE, a smoke build of the template project |

## AGENTS.md in a new project

Since version 0.5.0, `c4builder --new` puts an `AGENTS.md` into the project: build and check
commands, the workflow, the project layout, diagram conventions and the skills install command.
Codex, Cursor and Claude Code read it. The file sits next to `src/`, not inside it, and does not
end up in the documentation.

## llms.txt: architecture an agent can read

With `"generateLLMS": true` (since version 0.5.0, needs `generateWEB`) the site root gets two more
files following [llmstxt.org](https://llmstxt.org/):

- **`llms.txt`** — the entry point: the project name, a short description and a flat list of pages
  in sidebar order, like `- [System / Container](System/Container/Container.md)`. Folders from
  `excludeSidebarFolderByPath` are left out, plugin pages (such as `openspec`) are included. Links
  are relative to the site root.
- **`llms-full.txt`** — the full text of all pages in one file, in the same order as the single
  markdown file. Every diagram is inserted as its **source** in a `plantuml` or `d2` block instead
  of an image, regardless of `diagramFormat`, `embedDiagram` and `includeLinkToDiagram`. Local
  `!include` files and D2 imports (nested ones too) are listed once in the `## Included files`
  appendix at the end; stdlib includes `!include <C4/...>` and URL includes stay as lines in the
  diagram source.

The source is more useful than a picture: C4-PlantUML text (`Person`, `System`, `Rel`) is a
ready-made model, while an SVG link gives an agent nothing. To answer "what does service X depend
on", an agent can read `llms-full.txt` instead of crawling pages.

Without the site the build prints a warning and skips the files. New projects have the key on; an
existing `.c4builder` without the key builds as before — enable it with `c4builder --config` or by
adding `"generateLLMS": true` to the config.

Files of this site:

| | Russian version | English version |
|---|---|---|
| Index | [ru/llms.txt](https://alfacapital-tech.github.io/C4-Builder/ru/llms.txt) | [en/llms.txt](https://alfacapital-tech.github.io/C4-Builder/en/llms.txt) |
| Full text | [ru/llms-full.txt](https://alfacapital-tech.github.io/C4-Builder/ru/llms-full.txt) | [en/llms-full.txt](https://alfacapital-tech.github.io/C4-Builder/en/llms-full.txt) |

## Hints for agent instructions

A project created before 0.5.0 has no `AGENTS.md`. What to put into `AGENTS.md` or `CLAUDE.md` of
such a project:

- after editing a diagram — `c4builder check <file>`, fix until exit code 0;
- include C4 through the stdlib (`!include <C4/C4_Container>`), shared styles with
  `!include ../styles.iuml`;
- a new page is a new folder in `src/`, the order is set by a numeric prefix;
- `.puml` and `.d2` files in one folder must not share a name ignoring the extension: they share
  the output file, and the build stops with an error.

Add the pre-commit hook from the [Diagrams](03%20Diagrams/03%20Diagrams.md) page: it keeps a
diagram that does not compile out of a commit, whether a human or an agent made it.
