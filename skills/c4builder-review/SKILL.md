---
name: c4builder-review
description: Review c4builder pages with a human right on the local site - the human selects text in c4builder site -w and leaves comments with the Tell agent button, the agent receives them in batches with c4builder feedback --wait --as <name>, edits the sources and waits for the next batch until Approve. Use when asked to discuss a change on the site, to show the pages or a design, to review a page, the design or OpenSpec artifacts, when the human says they will leave comments on the page, right after proposing an OpenSpec change in a repository with c4builder, and on /c4builder-review [change-id|page].
---

# c4builder-review: page comments to the agent

The human looks at the pages in the browser (`c4builder site -w`), selects text and presses:

- **Tell agent** — a comment to you. It is not written to the files and comes to you in a batch:
  **Send now** sends one comment, **Add** → **Send to agent** sends several (from several pages
  too), **Approve** means nothing more to change.
- **Comment** (only with the `comments` key of `.c4builder`, formerly `reviewLog`) — a comment for people in the review
  log: c4builder appends it as a row of the nearest `comments.file` (`review.md` by default). It is
  not a task for you — leave it alone unless asked.

The `buttons` key of `.c4builder` may relabel both buttons (`agent`, `comment`).

Invocation: `/c4builder-review [change-id|page]`. `<port>` below is the port of the running site
from `c4builder status` (step 1); the commands find the server of this project by themselves.

The listener name (`<name>` below) is how the page picks the agent when several share one
`site -w`: the change id from the argument, otherwise the name of your task. Letters, digits,
`.`, `_`, `-`, up to 64 characters. Keep one name for the whole review.

## 1. Server

```bash
c4builder status
```

Exit code 0 — the site of this project is up: `<port>` below is the port in its first line
`site is running at http://localhost:<port> (pid …)`; never start a second one (it would refuse
with `c4builder site is already running for this project`). `listeners:` shows the other agents
reviewing on the same site and their queues; `c4builder status --json` prints the same as one
JSON object (`running`, `url`, `port`, `listeners`).

`… but did not answer in time` (exit code 0) — the server is busy, usually with a build: wait a few
seconds and run `c4builder status` again; never start a second one.

`no c4builder site of this project on … — the port is used by the c4builder site of another
project` (exit code 1) — another worktree's site holds the port: do not review on it; start this
project's site on a free port, `c4builder site -w -p <n>`.

Exit code 1 (`no c4builder site on …`) — ask the user to start `c4builder site -w`, or ask whether
you may start it yourself in the background — many teams keep the preview server in the human's
hands. If it exits with `port <port> is already in use — pass a different one, e.g. -p <n>`,
restart it with that `-p <n>` and run `c4builder status` again: the commands below find the server
by its state file, without `-p`.

`unknown command: status` — the CLI is older than this skill: tell the user, `c4builder update`
updates it (only when they agree). Until then `<port>` is `webPort` from `.c4builder`, and a server
on another port needs the same `-p <n>` in `c4builder feedback`.

The server answers right after `serving your docsify site`, before the diagrams are rendered: on
a cold cache the pages show `rendering…` placeholders that turn into images by themselves, the
open page first. That is normal — give the link without waiting. The background rendering ends
with `rendered N diagrams in T s` in the server output; `✗ <file>: line <N>: <message>` there is a
broken diagram worth fixing before the human reaches it.

## 2. Link

- Argument is an OpenSpec change id: the address is `http://localhost:<port>/#/change/<change-id>`
  — the short permanent address the `openspec` plugin declares for every change (active, nested or
  archived). It does not depend on the `mount`, `groupKey` and `nameKey` options, and the browser
  swaps it for the real page path. Do not search the build output and do not build the long path
  by hand. No command can check a `#/…` address — the hash never reaches the server: rely on
  `c4builder status` (step 1) and the `Change page: …` line that `c4builder feedback --as <change-id>` prints on
  stderr in step 3. No such line means the site has no change with this id: a typo, not built yet
  (the next rebuild adds it), or a CLI older than 0.10.0 — only then fall back to the build output:
  `find <distFolder> -path '*<change-id>*' -name '*.md' | head` (`distFolder` from `.c4builder`,
  `docs` by default), address `http://localhost:<port>/#/<path without .md>`.
- Argument is a page or a section: find it in the build output —
  `find <distFolder> -path '*<page>*' -name '*.md' | head`, address
  `http://localhost:<port>/#/<path without .md>`.
- No argument: the home page `http://localhost:<port>/`.

Give the link, remind in two lines what **Tell agent** and **Comment** do (see above) and say your
listener name: with several agents the human picks it in **Send to** on the agent bar.

## 3. Wait

Start in the background (in Claude Code: Bash with `run_in_background`):

```bash
c4builder feedback --wait --as <name>
```

It exits when a batch arrives; its stdout is the batch. When `<name>` is a change of the site, it
first prints `Change page: http://localhost:<port>/#/change/<name>` on stderr — the link from step
2 confirmed by the server. Connecting turns the **Tell agent** button on by itself, the server needs
no restart. Errors:

- `--as <name> is required` (exit code 2) — the name is missing or invalid: fix it and run again;
- `no c4builder site -w on …` (exit code 1) — no server or it crashed: back to step 1;
- `agent feedback is disabled on …` (exit code 1) — the server runs without `-w` or with
  `--no-agent`: ask the user to restart `c4builder site -w`;
- `unknown command: feedback` or `unknown option '--as'` — the CLI is older than this skill: tell
  the user, `c4builder update` updates it (only when they agree).

## 4. Batch

```text
# Page feedback (c4builder)

Decision: submitted
Comments: 1 on 1 page

## 1. OpenSpec/Changes/add-dark-mode/design.md (§ D3)
Sources: openspec/changes/add-dark-mode/design.md
Quote: "the selected text"

> what to change
```

Every comment names the site page, the page section (`§`), its source files (`Sources`) and the
quoted selection; `## General` is the overall comment of a review.

- Edit the files listed in `Sources` (change artifacts, `src/` and so on), never the build output.
  No `Sources` — find the quote in the sources (`grep -rn`). The page reloads by itself.
- Do not copy comments into the review log: they are instructions to you, not comments for
  people.
- A comment that is unclear or debatable — ask in the chat instead of guessing; do the rest of the
  batch.
- After the edits report briefly in the chat what you did for each comment number. Then run
  `c4builder feedback --wait --as <name>` in the background again with the same name — batches
  wait in your mailbox.

## 5. Done

`Decision: approved` — nothing more to change: apply the comments of that batch, if any, give a
summary of the changes by file and stop waiting. Do not commit unless the user asks.
