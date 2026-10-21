# CLI & configuration

## Commands

| Command | What it does |
|---|---|
| `c4builder` | builds the project in the current folder; without a config it runs the wizard first |
| `c4builder --new` | creates a project from the template in a new folder; since 0.5.0 also `c4builder new` |
| `c4builder --new --name demo -y` | the same without questions: a full config with default values |
| `c4builder --config` | setup wizard with the current values; since 0.5.0 also `c4builder config` |
| `c4builder site` | builds and serves the site locally (same as `--site`) |
| `c4builder --site -w` | the same, rebuilding on every save and reloading the browser |
| `c4builder feedback --wait --as <name>` | waits for the next batch of page feedback for the agent `<name>` from `site -w` and prints it, see "Feedback to the agent" below |
| `c4builder check <files...>` | checks `.puml`, `.iuml`, `.d2`, `.bpmn`, `.mmd` diagrams without a build, exit code 0 or 1 |
| `c4builder jre info` | which Java will be used (JSON) |
| `c4builder jre install [--force]` | download a JRE into the cache in advance; `--force` — even if system Java exists |
| `c4builder --list` | print the current config; since 0.5.0 outside a project — an error with exit code 1, no files created |
| `c4builder --reset` | clear the project config; since 0.5.0 outside a project — an error with exit code 1 |
| `c4builder --docs` | short reference of config keys and the address of this documentation |
| `c4builder update` | updates a global npm install to the newest version, otherwise prints how to update, see "Updating" below |

Positional commands are `check`, `jre`, `site`, `update`, `feedback`, and since 0.5.0 also `new` and `config`. Since
0.5.0 any other positional argument is an `unknown command` error with exit code 1: a typo
(`c4builder nwe`) no longer starts a build.

Flags:

| Flag | Meaning |
|---|---|
| `-c, --config-file <path>` | a different config file instead of `.c4builder` |
| `-w, --watch` | rebuild on changes in the sources and plugin folders |
| `-o, --open` | open the site in the browser (with `--site`) |
| `-p, --port <n>` | port for `--site` and `feedback` (defaults to `webPort` from the config, 3000) |
| `--agent`, `--no-agent` | turn the agent mode of `site -w` on or off regardless of the environment |
| `--wait` | for `feedback`: wait for the next batch instead of only checking the queue |
| `--as <name>` | for `feedback`, required: listener name — the agent's change or task (1–64 characters: Latin letters, digits, `.`, `_`, `-`) |
| `--system-fonts` | render with system fonts for one run |
| `-V, --version` | version |

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
with code 0. Without `--wait` the command prints a batch if one is already in the mailbox, otherwise
nothing, and exits at once. Without `--as` or with an invalid name — exit code 2 and
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
| `repoUrl` | empty | repository link in the corner of the site |
| `executeScript` | `false` | run `<script>` in pages and load swagger-ui |
| `docsifyTemplate` | empty | path to a module with a custom `index.html` template |
| `webPort` | `3000` | port of `c4builder site` |
| `questionsHeading` | `Open questions` | heading of the section where `site -w` appends questions left on the page |
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
