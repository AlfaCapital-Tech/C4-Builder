# CLI & configuration

## Commands

| Command | What it does |
|---|---|
| `c4builder` | builds the project in the current folder; without a config it runs the wizard first, without a terminal — an error with exit code 1 |
| `c4builder --new` | creates a project from the template in a new folder; since 0.5.0 also `c4builder new` |
| `c4builder --new --name demo -y` | the same without questions: a full config with default values |
| `c4builder --config` | setup wizard with the current values; since 0.5.0 also `c4builder config` |
| `c4builder site` | builds and serves the site locally (same as `--site`) |
| `c4builder --site -w` | the same, rebuilding on every save and reloading the browser |
| `c4builder feedback --wait --as <name>` | waits for the next batch of page feedback for the agent `<name>` from `site -w` and prints it, see "Feedback to the agent" below |
| `c4builder check <files...>` | checks `.puml`, `.iuml`, `.d2`, `.bpmn`, `.mmd`, `.wireflow.json` diagrams without a build, exit code 0 or 1 |
| `c4builder jre info` | which Java will be used (JSON) |
| `c4builder jre install [--force]` | download a JRE into the cache in advance; `--force` — even if system Java exists |
| `c4builder --list` | print the current config; since 0.5.0 outside a project — an error with exit code 1, no files created |
| `c4builder --reset` | clear the project config; since 0.5.0 outside a project — an error with exit code 1 |
| `c4builder --docs` | short reference of config keys and the address of this documentation |
| `c4builder update` | updates a global npm install to the newest version, otherwise prints how to update, see "Updating" below |
| `c4builder skills` | installs or updates the agent skills of the CLI's own version in the current folder: `.agents/skills/`, under Claude Code also `.claude/skills/`; needs no project config, see "Agent skills" on the [Agents](08%20Agents/08%20Agents.md) page |
| `c4builder doctor [group...]` | diagnostics: environment, agent skills, a test render, the project and the port; read-only, works outside a project and without a terminal, see "Diagnostics" below |

Positional commands are `check`, `jre`, `site`, `update`, `feedback`, since 0.5.0 also `new` and `config`, since 0.10.0 `skills`, later `doctor`. Since
0.5.0 any other positional argument is an `unknown command` error with exit code 1: a typo
(`c4builder nwe`) no longer starts a build.

Flags:

| Flag | Meaning |
|---|---|
| `-c, --config-file <path>` | a different config file instead of `.c4builder` |
| `-w, --watch` | rebuild on changes in the sources and plugin folders |
| `-o, --open` | open the home page of the site in the browser (with `--site`) |
| `--open-change <id>` | open the page of an OpenSpec change by the short address `#/change/<id>` in the browser (with `--site`, see [Plugins](06%20Plugins/06%20Plugins.md)); when the site has no such address — a warning on stderr, the address is opened anyway |
| `-p, --port <n>` | port for `--site`, `feedback` and `doctor` (defaults to `webPort` from the config, 3000) |
| `--agent`, `--no-agent` | turn the agent mode of `site -w` on or off regardless of the environment |
| `--wait` | for `feedback`: wait for the next batch instead of only checking the queue |
| `--as <name>` | for `feedback`, required: listener name — the agent's change or task (1–64 characters: Latin letters, digits, `.`, `_`, `-`) |
| `--system-fonts` | render with system fonts for one run |
| `--json`, `-v, --verbose`, `--strict`, `--full`, `--offline` | for `doctor`, see "Diagnostics" below |
| `-V, --version` | version |
| `-h, --help` | flags and positional commands |

## The `--site -w` dev server

`c4builder --site -w` serves the site as soon as the pages are composed, without waiting for the
diagrams. Diagrams missing from the cache (a fresh clone, the first build in a CI preview) get a
`rendering…` placeholder image in their place, and the rendering goes on in the background after
the `serving your docsify site` line:

```text
serving your docsify site
go to http://localhost:3000
rendering 179 diagrams in background…
rendered 179 diagrams in 118.4 s
```

- The diagrams of the page open in the browser are rendered first: the page tells the server
  about every navigation, and it moves that page's diagrams to the head of the queue. The `.md`
  requests the docsify search makes for its index do not touch the queue.
- BPMN and mermaid diagrams render in a separate thread (a worker thread): while they render, the
  server keeps answering requests and sending events to the pages. PlantUML already runs in
  separate java processes.
- Every finished image replaces its placeholder on the open page without a reload and without
  losing the scroll position. When the queue is done, the server runs a regular rebuild
  (everything is cached now — a fraction of a second) and reloads the pages: that is how inlined
  diagrams (`embedDiagram`), the complete document and `llms-full.txt` get the real images, and
  source edits made during the rendering land on the site. Finished images also show up when you
  come back to a page that had a placeholder.
- A render error in the background does not stop the server: the diagram shows an error
  placeholder, the log gets `✗ Diagram "<file>": <reason>`. As long as the diagram input (the file
  and its includes/imports) is unchanged, the rebuilds of this run do not render it again — they
  carry the placeholder over and print a gray `unchanged since it failed, not re-rendered` line.
  Fixing the file triggers a regular rebuild that renders it; a new `site -w` run retries every
  failed diagram.
- A warm start (everything cached) creates no placeholders and renders nothing in the background.

The `-w` output is for viewing, not for publishing: stopping the server before the background queue
is done leaves placeholders in `distFolder` (they have no checksums, the next build re-renders
them). A build without `-w` — `c4builder site` included — still waits for every diagram and fails
if any of them does not render.

The port is fixed: `-p` or `webPort`. When it is taken, the server does not start and exits with
code 1, suggesting a free one of the next ports: `port 3000 is already in use — pass a different
one, e.g. -p 3001` (none of them is free — `… with -p <port>`). The server never moves to another
port by itself: `feedback`, `--open-change` and the agent skills take the port from `-p` or
`webPort`, so restart with the suggested `-p` and pass the same `-p` to `c4builder feedback`.

## Updating

Once a day c4builder asks the npm registry in the background whether a new version is out. The
request is made by `npm view` with the registry, proxy and certificates from your npmrc — the same
path the update is installed through later. A run neither waits for the check nor depends on the
network: the answer is saved to `~/.config/c4builder/dist-tags.json` (`$XDG_CONFIG_HOME/c4builder/`
when the variable is set) and used from the next run on. A stable version is compared with `latest`,
a release candidate with the greater of `latest` and `rc`.

When a newer version is known, one line is printed to stderr at the end of the run:

```text
c4builder 0.6.0 is available (current 0.5.1). Run: c4builder update
```

In `c4builder site -w` a dismissible banner in the corner of the page tells about the new version;
it never gets into the build output.

`c4builder update` installs the newest version when c4builder is installed globally (`npm i -g`),
showing npm's output. Otherwise it installs nothing, prints the update command and exits with code
1: `npm i -D` for a project dependency, `docker pull` in the Docker image.

The check and the notices are off when the `CI` variable is set (GitLab CI, GitHub Actions and most
CI systems set it) or `NO_UPDATE_NOTIFIER` is set, and in the Docker image. To turn them off on your
machine: `NO_UPDATE_NOTIFIER=1`.

## Diagnostics

`c4builder doctor` shows in one command what gets in the way, with a `fix:` line — a command or a
link — under every problem. It only reads: it installs and downloads nothing (no JRE either), does
not touch the config and does not start the wizard. It works in any folder, in CI and under an agent.

```text
c4builder doctor 0.14.0 (latest)
Environment
  ✓ Node.js 24.11.0
  ✓ c4builder 0.14.0 (latest)
  ✓ no newer version
  ✓ global npm
  ✓ Java 21 (system)
  – no .d2 files in the project
  ✓ bundled font Nimbus Sans
  ✓ no proxy variables set
Skills (claude-code)
  ✓ .agents/skills — 0.14.0
  ✗ .claude/skills — from 0.12.0, CLI 0.14.0
      fix: c4builder skills   (ask the user first)
  – what the agent session loaded is not visible to the CLI
Render
  ✓ PlantUML with C4 in 0.9 s
Project
  ✓ .c4builder valid
  ✓ non-interactive build ready
  ✓ rootFolder src and plugin paths exist
Runtime
  ✓ port 3000 free
  ✓ coding agent claude-code, agent mode on
1 error, 0 warnings
```

Statuses: `✓` ok, `!` warning, `✗` error, `–` the check does not apply or was not run (no network,
no `.d2` in the project). `(ask the user first)` — the fix changes project files or removes a
personal skill copy: an agent runs it only with the human's consent.

| Group | Checks |
|---|---|
| `env` | `env.node` — Node.js is not older than the package's `engines`; `env.cli` — version and channel; `env.update` — whether a newer version is out; `env.install` — how c4builder is installed, several `c4builder` on `PATH`; `env.java` — a system Java 17+ or a JRE in the cache; `env.d2` — the D2 engine when the project has `.d2` files; `env.fonts` — `useSystemFonts`; `env.proxy` — whether `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` are set and the certificate file exists |
| `skills` | the package skills in the agent's folders: `skills.<agents\|claude\|codex>.<project\|personal>` — the set, the version, text equal to the package, a shadowing personal copy; `skills.installed` — the agent has no skills; `skills.claude.plugins` — Claude Code plugins with the same skills; `skills.session` — always `–`: the CLI cannot see what the agent session loaded |
| `render` | `render.plantuml` — a tiny C4 diagram with the build's engine; `render.d2`, `render.mermaid` — when the project has such files; `render.full` — with `--full` |
| `project` | `project.config` — `.c4builder` is found and valid; `project.complete` — the build runs without the wizard; `project.paths` — `rootFolder` and plugin paths exist |
| `runtime` | `runtime.port` — the `webPort` (or `-p`) port is free, serves `site -w` or another process; `runtime.agent` — which agent is detected and whether agent mode is on |

`c4builder doctor skills project` runs only the listed groups; an unknown group prints the list of
groups with exit code 2. Skill folders: under an agent — its own and `.agents/skills`, without one —
all of them (Claude Code, Codex, `.agents`).

| Flag | Meaning |
|---|---|
| `--json` | one JSON object on stdout: `version`, `channel`, `agent`, `checks` (`id`, `status`, `message`, `fix`, `askUser`, `details`), `summary`; check ids do not change between versions |
| `-v, --verbose` | absolute paths and details (the java path, skill files that differ from the package, the smoke build log) |
| `--strict` | exit code 1 on warnings too — for CI |
| `--full` | in addition to the tiny diagram, builds the template project (`--new --name doctor -y`) in a temporary folder removed whatever the outcome; without Java — `–` |
| `--offline` | no network requests at all |

Exit codes: 0 — no errors (warnings are fine), 1 — an error, with `--strict` a warning too, 2 — an
unknown group. `–` does not affect the code.

doctor checks for a new version itself — `npm view` with a 3 s timeout; no answer is `–`, not an
error. `CI` and `NO_UPDATE_NOTIFIER` do not turn this check off: doctor is run on purpose. `doctor`
has no background check and no new version line at the end.

The output without `-v` is safe to paste into an issue: the home folder is shown as `~`, paths inside
the project are relative, there are no values of environment variables — only whether a variable is
set.

## Comments on the site

In `c4builder site -w` you can leave a question about any place on a page: select text, press the
**Question** button next to the selection, write the question and press **Add question** (`Ctrl+Enter`). The
question is appended to the page's source `.md`, into the section titled by the `questionsHeading`
key (`Open questions` by default): as a table row when the section is a table (with the next number
if the first column is numeric), otherwise as a list item; a missing section is created at the end of
the file. The text is the comment, the quoted selection and the heading of the page section. Watch
rebuilds the site and the page reloads with the question in place. The quoted text on the page is
highlighted in yellow with the question number above it linking to its row. A «×» button on the
question row (shown on hover) removes it from the file; the other numbers
stay as they are. Pages without a source file
(summaries, indexes) do not accept questions. Without `-w` and on static hosting there is no button.

### Review log

A remark that belongs in a separate review log rather than in the document itself (for OpenSpec,
the change's `review.md`) is added with the **Review** button next to **Question**. The button appears
when `.c4builder` has the `reviewLog` key:

```json
{
  "reviewLog": {
    "file": "review.md",
    "heading": "Remarks",
    "cells": ["", "{artifact} → {section}", "{text}", "{author}", "", ""],
    "author": "",
    "label": ""
  }
}
```

- `file` — the log file name (`review.md` by default): the nearest one from the page's source
  directory up the tree to the project root, so a remark on a delta page `specs/<area>/spec.md` lands in
  the change's `review.md`. A missing file is an error; the log is not created.
- `heading` — the log section (`Review` by default): a string or a list of variants when log templates
  differ (`["Remarks", "Design remarks"]`) — the first one found in the file is used, with none present
  the first is created. The remark is appended like a question: as a table row or a list item.
- `cells` — the table row cells with placeholders: `{comment}` — the text, `{quote}` — the quote (up
  to 200 characters), `{text}` — `{comment} — «{quote}»`, `{section}` — the page section, `{artifact}`
  — the source file name without extension (`design`, `spec`; the folder name for `README.md`),
  `{page}` — the source relative to the log's directory, `{author}`, `{date}` (YYYY-MM-DD),
  `{number}` — the row number. A numeric first column gets the number by itself; extra template
  cells are dropped, missing ones are empty. Without `cells` the row is the same as a question's.
- `author` — the author; by default `git config user.name` of whoever runs `site -w`.
- `label` — the button text instead of **Review**.
- `enabled` — `false` turns the button and the log routes off without removing the rest of the settings.

The **Question** button is always on; `questions: false` turns it off together with question
highlighting and removal.

On the log's own page (the page whose source is `file`) the rows of the `heading` section have a «×»
button, as questions do: it removes the row from the file, the other numbers stay. On the page a remark
was made from, its quote is highlighted in yellow and the number above it links to the log row. Which
rows belong to a page follows from `cells`: the cell with `{artifact}` or `{page}` is compared with the
page, the quote comes from `{quote}` or the tail of `{text}`; without such placeholders every row with a
quote is highlighted.

The page interface is in English or Russian, following the browser language; the `uiLanguage` key
pins it. The button names here are the English ones; the Russian labels are on the
[Agents](08%20Agents/08%20Agents.md) page.

A question stays in the file, for people. When a coding agent edits the docs, the agent mode adds a
second button next to the selection — **Feedback**: the comment goes to the agent and is never
written to the files.

## Feedback to the agent

The agent mode of `site -w` is on when any of these holds:

- the `--agent` flag is passed;
- `C4BUILDER_AGENT` is set to anything but `0` (the value is the agent name in the hint);
- a variable of a known agent is set: `CLAUDECODE` (Claude Code), `CODEX_THREAD_ID` (Codex),
  `GEMINI_CLI`, `OPENCODE`, `COPILOT_CLI` or `AI_AGENT`;
- the `c4builder feedback` command has connected to the server — the mode turns on at once, and the
  page shows the **Feedback** button without a reload.

`--no-agent` or `C4BUILDER_AGENT=0` turn the mode off whatever else holds; flags win over
variables. Started in the agent mode by a flag or a variable, `site -w` prints a hint on how to
receive the feedback.

On the page the selection gets two buttons: **Feedback** (to the agent) and **Question** (a question
in the file). The Feedback popover sends the comment right away (**Send now**) or keeps it in a review
(**Add to review**), as in a GitLab merge request: once a review is started, the main button and
`Ctrl+Enter` are **Add to review**. The review bar at the bottom of the page shows the number of
pending comments and pages, the recipient and its state (`foo: listening ●` / `foo: reconnecting ○`,
with no agents `agent: not listening ○`) and the buttons. While the draft is empty, there is one button, **Done — no changes**: nothing to
change, the agent gets an `approved` batch with no comments. Once the draft has comments, the
buttons are **Submit review** (with an optional overall comment), **Approve** (nothing more to
change; pending comments go along) and **Discard** (clear the draft, nothing goes to the agent).
A click on the counter opens the list with a
«×» on every comment. The draft is kept in the browser's `localStorage` per project and recipient,
survives a reload and a closed tab, and its quotes are highlighted in blue.

Several agents can work with one `site -w`: each listens under its own name (`--as <name>`), and
the server keeps a mailbox per name. With more than one recipient the bar shows **Send to** with
the names and their state (`listening`, `reconnecting`, the number of queued batches). The choice
is remembered per tab and survives a reload, so three tabs can work with three agents. Until the
tab picks a recipient, the send buttons are disabled. With one agent there is no choice: it becomes
the tab's recipient by itself. A draft started before any agent came goes to the tab's first
recipient.

`c4builder feedback --wait --as <name>` connects to `site -w` on the port from `-p` or `webPort`,
waits for the next batch for `<name>` with no time limit, prints it to stdout as markdown and exits
with code 0. When `<name>` is the id of a change on the site (the `openspec` plugin), the command
first prints one stderr line `Change page: http://localhost:<port>/#/change/<name>` — the link to
the change page for the human; stdout stays reserved for the batch, and there is no line when the
site has no such change. Without `--wait` the command prints a batch if one is already in the
mailbox, otherwise nothing, and exits at once. Without `--as` or with an invalid name — exit code 2 and
`--as <name> is required` with an example, the server is not contacted. No server, or the mode is
off — exit code 1 and a message with the server address. A batch sent to a recipient that is not
listening (say, the agent is editing files between batches) waits in its mailbox and goes to the
next command with the same name; a batch sent before any agent came goes to the first command that
connects. The page says "queued for `<name>`", and "delivered to `<name>`" only once a command got
the batch. An empty mailbox nobody connected to for 30 minutes leaves the list; a mailbox with
batches stays. Mailboxes live in the memory of the `site -w` process. The batch format and the
agent loop are on the [Agents](08%20Agents/08%20Agents.md) page.

## How the config is read

`.c4builder` is JSON in the project folder. The first build asks for missing keys through the
wizard and sets `hasRun: true`; after that, `c4builder` builds without questions. `new -y` writes
a full config right away, so there is no wizard at all.

The wizard needs a terminal. Without one (CI, a background run, a coding agent) a missing config is
an error with exit code 1 that creates no files, and an incomplete one stops at the first question
with `aborted: the prompt was closed` and exit code 1. Closing the wizard with `Ctrl+C` also exits
with code 1. A `.c4builder` that is not valid JSON is an error naming the file and the parse problem;
the file is left as it is.

Keys are validated against a schema. A value of the wrong type stops the build with an error
naming the key, and `c4builder --config` lets you fix it. Unknown keys are silently dropped — this
way an older c4builder does not fail on a config written by a newer one. Keys of features removed
in older versions produce a warning listing them, and the build continues.

## `.c4builder` keys

| Key | Default | What it sets |
|---|---|---|
| `projectName` | name given at creation | project name: title of the site and of the single file |
| `homepageName` | `Overview` | title of the root page |
| `rootFolder` | `src` | sources folder |
| `distFolder` | `docs` | output folder, recreated on every build |
| `generateWEB` | `true` | docsify site |
| `generateMD` | `true` | markdown per folder |
| `generateCompleteMD` | `false` | single `<projectName>.md` file |
| `generateLLMS` | `true` in new projects, off when absent | `llms.txt` and `llms-full.txt` for agents, needs `generateWEB` (since 0.5.0) |
| `includeTableOfContents` | `true` | page tree at the top of each markdown file |
| `includeNavigation` | `false` | links to the parent and child pages in markdown |
| `includeBreadcrumbs` | `true` | page path under the title |
| `diagramsOnTop` | `true` | diagrams before the page text |
| `includeLinkToDiagram` | `false` | a link instead of the diagram image |
| `embedDiagram` | `false` | image embedded in markdown as base64 |
| `excludeOtherFiles` | `false` | do not copy other files from the sources |
| `generateLocalImages` | `true` | local rendering; `false` — links to an online server |
| `plantumlServerUrl` | `https://www.plantuml.com/plantuml` | server for `generateLocalImages: false` |
| `diagramFormat` | `svg` | `svg` or `png` |
| `d2Layout` | `dagre` | D2 layout: `dagre` or `elk` |
| `useSystemFonts` | `false` | system fonts instead of the bundled one |
| `charset` | `UTF-8` | encoding of PlantUML sources |
| `webTheme` | `vendor/vue.css` | docsify CSS theme |
| `supportSearch` | `true` | search in the sidebar |
| `sidebarCollapse` | `true` | collapsible sidebar sections: the first level and the path to the current page are open; `false` — the whole tree expanded |
| `repoUrl` | empty | repository link in the corner of the site |
| `executeScript` | `false` | run `<script>` in pages and load swagger-ui |
| `docsifyTemplate` | empty | path to a module with a custom `index.html` template |
| `webPort` | `3000` | port of `c4builder site` |
| `questions` | `true` | the **Question** button of `site -w`; `false` — no button and no question highlighting |
| `questionsHeading` | `Open questions` | heading of the section where `site -w` appends questions left on the page |
| `reviewLog` | — | review log for the **Review** button of `site -w`: `enabled`, `file`, `heading`, `cells`, `author`, `label` — see [Review log](#review-log) |
| `uiLanguage` | `auto` | language of the `site -w` page interface: `auto` (from the browser), `en` or `ru` |
| `webFileName` | — | one `.md` name for all site pages instead of the folder name |
| `excludeSidebarFolderByPath` | — | list of paths (from the project folder, e.g. `src/Archive`) hidden from the sidebar |
| `plugins` | `[]` | build plugins, see [Plugins](06%20Plugins/06%20Plugins.md) |

The config of this documentation site is a live example: `docs/en/.c4builder` in the repository.

## Custom docsify template

`docsifyTemplate` points to an ESM or CommonJS module that exports a function. The function
receives the docsify settings object (name, sidebar, theme, search) and returns the HTML for
`index.html`. Start from the built-in template in `src/core/compose/docsify.template.ts`; this
site uses its own, `docs/docsify-template.mjs`.

The template does not need to load the sidebar collapsing (`sidebarCollapse`): the build injects
its script and style into the finished `index.html` as a post-processing step, like plugin assets,
and the display level arrives in the settings object as `sidebarDisplayLevel` — just put the whole
object into `window.$docsify`. If the template already loads
`vendor/docsify-sidebar-collapse.min.js` itself, the file is not added a second time.
