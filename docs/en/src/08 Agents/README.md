# Agents

An agent edits a C4 model in text form as confidently as code: `Person`, `System`, `Container`
and `Rel` in a `.puml` are a ready-made semantic model, not a picture. What it usually lacks is
something else: a fast, unambiguous answer to "did I break it?". c4builder gives that answer
locally, without a network and without a human.

## The edit → check → build loop

1. **Edit.** The agent changes `.md` and `.puml`/`.d2`/`.bpmn`/`.mmd` files in `src/` — adds a
   container, a relationship, a page, a process step.
2. **Check.** `c4builder check` on the changed files:

   ```bash
   c4builder check "src/1 Internet Banking System/system.puml"
   ```

   Exit code 0 — everything compiles. Exit code 1 — the output has a line with the file and the
   line number:

   ```text
   ✗ src/1 Internet Banking System/system.puml: line 12: Fatal parsing error
   ```

   The check uses the same engine and the same `!include`s as the build and takes seconds: the
   agent fixes the error and repeats until it gets 0. For `.bpmn`, every model violation is a
   line with the element id and the rule: `✗ <file>: <id> [<rule>] <description>`; for `.mmd`
   — the line number, as for PlantUML.
3. **Build.** `c4builder` builds the whole project; `c4builder --site -w` keeps the site open for
   the human and rebuilds it on every save the agent makes. It comes up right away, without
   waiting for the rendering: diagrams missing from the cache show a `rendering…` placeholder and
   are drawn in the background (see "CLI and configuration").

A full build also exits with a non-zero code if any diagram fails to render, so it can be the
agent's last step or a CI step.

## Feedback from the page

It is easier for a human to point the agent at a place on the page than to retell it in the chat.
In `c4builder site -w` under an agent (see "Feedback to the agent" on the
[CLI & configuration](05%20CLI%20and%20configuration/05%20CLI%20and%20configuration.md) page) the
selection gets a **Feedback** button: the comment goes to the agent right away (**Send now**) or in a
review batch (**Submit review**, **Approve**). With nothing to change, the empty review bar has one
button, **Done — no changes**: it sends an `approved` batch with no comments. **Discard** only clears
the draft and sends nothing to the agent. The agent loop:

1. Start `c4builder --site -w` and `c4builder feedback --wait --as <name>` in the background,
   `<name>` being the agent's change or task, e.g. `--as add-dark-mode`. In Claude Code — both
   through Bash with `run_in_background`: the agent is notified when `feedback --wait` exits. The
   page link can be given right after the `serving your docsify site` line: on a fresh clone the
   diagrams are still rendering in the background, and the `rendering…` placeholders on the page
   turn into images by themselves.
2. `feedback --wait` prints a batch and exits. The agent edits the sources in `src/` — the page
   reloads through livereload and the human sees the result.
3. Run `c4builder feedback --wait --as <name>` again with the same name and wait for the next batch.
4. A batch with `Decision: approved` means nothing more to change: finish its comments, if any, and
   stop waiting.

The `c4builder-review` skill (see "Agent skills" below) runs this whole loop: on
`/c4builder-review [change-id|page]` the agent checks that `site -w` responds, gives the link to the
change or section page, waits for the batches and reports in the chat by comment number.

A batch looks like this:

```markdown
# Page feedback (c4builder)

Decision: submitted
Comments: 2 on 2 pages

## 1. Arch/Flow/Flow.md (§ Flow)
Sources: src/Arch/Flow/README.md
Quote: "foo bar"

> Rename to baz

## 2. Arch/Arch.md
Sources: src/Arch/README.md
Quote: "deploy step"

> Explain why it is manual

## General

> Keep the tone
```

`Sources` are the source files of the page (missing for pages without a source), `§` is the page
section where the text was selected, `General` is the overall review comment. A batch sent while the
agent was not listening waits in its `site -w` mailbox and arrives on the next run of the command
with the same name.

Without `--as` the command exits at once with code 2 and
`--as <name> is required: name this listener after your change or task …` — an agent with an older
instruction restarts the listener with a name from that message. Code 2, not 1: code 1 means no
`site -w` is running.

A feedback comment is an instruction to the agent, not a question: it is never written to the files.
Questions for people (the **Question** button) go to the `questionsHeading` section of the source
`.md` and stay in the documentation — the agent should not move feedback there or answer it by
editing the questions section.

### Several agents

Several agents, each with its own change, can work with one `site -w`: each listens under its own
name, and a batch goes only to the agent with that name. The page shows **Send to** with the agents
and their state; the recipient is picked per tab, and every recipient has its own review draft. So
a human reviews change A in one tab and change B in another, and no comment reaches the wrong
agent. Keep the name the same on every run of the command: with another name the batches stay in
the old mailbox.

### Interface language

The page interface — buttons, hints, the review bar, toasts — comes in English and Russian. The
language follows the browser settings: the first language in the preference list that the dictionary
has (`en` or `ru`), otherwise English. To pin the language for a project, set the `.c4builder` key:

```json
{ "uiLanguage": "en" }
```

`auto` (the default) follows the browser, `en` and `ru` always use that language. This page names
the English buttons; the Russian interface shows **Замечание** (Feedback), **Вопрос** (Question),
**Отправить** (Send now), **В ревью** (Add to review), **Отправить ревью** (Submit review),
**Одобрить** (Approve), **Очистить** (Discard), **Готово, правок нет** (Done — no changes),
**Кому** (Send to). The
interface language does not change the CLI output, the `c4builder feedback` batch, server error
texts or the questions section heading (`questionsHeading`).

## Why offline rendering matters for agents

- **No network, no random failures.** The PlantUML jar, the C4 library, the font, D2, the BPMN and
  mermaid engines ship with the package; the build does not depend on plantuml.com, proxies or rate limits.
- **Same input, same output.** The bundled font and pinned engine versions give identical SVG on
  any machine. The pull request diff shows what the agent changed in the model, not
  environmental noise.
- **Sources stay inside.** Architecture often contains things that do not belong on someone
  else's server; local rendering rules that out.

## Agent skills

c4builder ships [Agent Skills](https://agentskills.io) for Claude Code, Codex, Cursor and other
agents. Since version 0.10.0 the skills are part of the npm package and describe exactly the installed
CLI version. This command installs them into the project:

```bash
c4builder skills
```

It works offline and copies every skill of the package into the current folder:

- `.agents/skills/` — always: the shared Agent Skills folder read by Codex and other agents;
- `.claude/skills/` — when the command runs from Claude Code (`CLAUDECODE`) or the folder already has
  `.claude/`: Claude Code reads only that one.

The folder of every package skill is replaced as a whole: files of older versions are removed, other
skills next to them are left alone. There is no separate update command — just run it again. The
installed `SKILL.md` gets the version of the CLI that installed it:

```yaml
metadata:
  generatedBy: "0.10.0"
```

`c4builder --new` installs the skills into a new project by the same rules. The folders sit next to
`src/` and do not end up in the documentation. Installed skills are generated files, like those of
`openspec update`: the next run overwrites local edits.

| Skill | Use it for |
|---|---|
| `c4builder` | working on a project: layout of `src/` and `.c4builder`, the edit → `c4builder check` → build loop, C4-PlantUML conventions (stdlib includes, shared `.iuml`, offline rendering), D2, BPMN processes without coordinates, mermaid (`.mmd` and blocks, unsupported types), the `openspec` and `openapi` plugins, `llms.txt`, the new version and skills notices |
| `c4builder-review` | reviewing pages on `c4builder --site -w`: checking the server, the link to the change or section page, the `c4builder feedback --wait --as <name>` loop, a report in the chat; invoked as `/c4builder-review [change-id\|page]` |
| `c4builder-setup` | install and update (npm channels `latest` and `rc`, a registry mirror through npmrc or `--registry`, the Docker image), Java or the downloaded JRE, a smoke build of the template project, installing the skills into the project |

### Skills notice

A build and `c4builder site` (`-w` included) run by an agent check at start the `c4builder` skill this
agent will load, and print one line to stderr when it is missing, older than the CLI or shadowed by a
stale personal copy:

```text
c4builder agent skills are not installed here. Ask the user, then run: c4builder skills
c4builder agent skills here are from 0.9.0 (current 0.10.0). Ask the user, then run: c4builder skills
~/.claude/skills/c4builder (no version) overrides project skills. Ask the user to remove it, then run: c4builder skills
```

Which copy counts: the agent's folder is `.claude/skills` for Claude Code and `.agents/skills` for
the others. A personal copy (`~/.claude/skills/c4builder`, `~/.agents/skills/…` for other agents)
wins over the project one; without it the nearest project copy counts — in the current folder or
above, up to the root of the git repository. A copy without a version stamp or with an older one is
outdated. A copy newer than the CLI prints nothing: in a shared repository with committed skills a
colleague with an older CLI needs no advice to roll them back — the new version notice tells them
about the CLI.

"Ask the user" is there because an agent reads the line: without it the agent would silently put
files into the repository. The `c4builder` skill teaches the agent to tell the human and to run
`c4builder skills` or remove the personal copy only with their consent. The line changes neither
stdout nor the exit code. It is not printed without an agent, in `c4builder check` (an agent calls
it dozens of times per loop), where the new version check is off (`CI`, `NO_UPDATE_NOTIFIER`, the
Docker image) and with `C4BUILDER_AGENT=0`. The `--agent`/`--no-agent` flags do not affect it.

A personal copy is usually left by `npx skills add -g`. `c4builder skills` does not remove it but
warns about it on stderr.

### Alternative: npx skills

The [`skills`](https://github.com/vercel-labs/skills) CLI installs the skills from the repository —
for a personal install (`-g`) and for other agents' folders (`.cursor/` and so on) that
`c4builder skills` does not fill:

```bash
npx skills add AlfaCapital-Tech/C4-Builder/skills                    # all skills into the current project
npx skills add AlfaCapital-Tech/C4-Builder/skills --skill c4builder  # just one
```

This installs the state of the default branch without a version stamp: it may describe flags of a
CLI version that is not out yet. The `/skills` path in the command matters: without it the CLI also
picks up the internal development skills of c4builder itself from `.claude/skills/`.

## AGENTS.md in a new project

Since version 0.5.0, `c4builder --new` puts an `AGENTS.md` into the project: build and check
commands, the workflow, the project layout, diagram conventions and the skills install command;
since 0.10.0 it also installs the skills themselves (see above).
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
  markdown file. Every diagram is inserted as its **source** in a `plantuml`, `d2`, `mermaid` or `xml` (BPMN) block instead
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
- `.puml`, `.d2`, `.bpmn` and `.mmd` files in one folder must not share a name ignoring the extension: they share
  the output file, and the build stops with an error.

Add the pre-commit hook from the [Diagrams](03%20Diagrams/03%20Diagrams.md) page: it keeps a
diagram that does not compile out of a commit, whether a human or an agent made it.
