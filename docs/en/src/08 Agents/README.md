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

## Hints for agent instructions

What to put into `AGENTS.md` or `CLAUDE.md` of a project with a C4 model:

- after editing a diagram — `c4builder check <file>`, fix until exit code 0;
- include C4 through the stdlib (`!include <C4/C4_Container>`), shared styles with
  `!include ../styles.iuml`;
- a new page is a new folder in `src/`, the order is set by a numeric prefix;
- `.puml` and `.d2` files in one folder must not share a name ignoring the extension: they share
  the output file, and the build stops with an error.

Add the pre-commit hook from the [Diagrams](03%20Diagrams/03%20Diagrams.md) page: it keeps a
diagram that does not compile out of a commit, whether a human or an agent made it.
