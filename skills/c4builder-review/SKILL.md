---
name: c4builder-review
description: Review c4builder pages with a human right on the local site - the human selects text in c4builder --site -w and leaves comments with the Feedback button, the agent receives them in batches with c4builder feedback --wait --as <name>, edits the sources and waits for the next batch until Approve. Use when asked to discuss a change on the site, to show the pages or a design, to review a page, the design or OpenSpec artifacts, when the human says they will leave comments on the page, right after proposing an OpenSpec change in a repository with c4builder, and on /c4builder-review [change-id|page].
---

# c4builder-review: page comments to the agent

The human looks at the pages in the browser (`c4builder --site -w`), selects text and presses:

- **Feedback** — a comment to you. It is not written to the files and comes to you in a batch:
  **Send now** sends one comment, **Add to review** → **Submit review** sends several (from several
  pages too), **Approve** means nothing more to change.
- **Question** — a question for people: c4builder appends it to the source `.md` under the
  `questionsHeading` section (`Open questions` by default). It is not a task for you — leave it
  alone unless asked.

Invocation: `/c4builder-review [change-id|page]`. The port is `webPort` from `.c4builder`
(`<port>` below); when the server runs with `-p <n>`, pass the same `-p <n>` to the commands below.

The listener name (`<name>` below) is how the page picks the agent when several share one
`site -w`: the change id from the argument, otherwise the name of your task. Letters, digits,
`.`, `_`, `-`, up to 64 characters. Keep one name for the whole review.

## 1. Server

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/
```

`200` — the server is up; never start a second one. Otherwise ask the user to start
`c4builder --site -w`, or ask whether you may start it yourself in the background — many teams
keep the preview server in the human's hands.

The server answers right after `serving your docsify site`, before the diagrams are rendered: on
a cold cache the pages show `rendering…` placeholders that turn into images by themselves, the
open page first. That is normal — give the link without waiting. The background rendering ends
with `rendered N diagrams in T s` in the server output; `✗ Diagram "<file>": <reason>` there is a
broken diagram worth fixing before the human reaches it.

## 2. Link

- Argument is an OpenSpec change id: the address is `http://localhost:<port>/#/change/<change-id>`
  — the short permanent address the `openspec` plugin declares for every change (active, nested or
  archived). It does not depend on the `mount`, `groupKey` and `nameKey` options, and the browser
  swaps it for the real page path. Do not search the build output and do not build the long path
  by hand. `curl` cannot check a `#/…` address — the hash never reaches the server: check `/`
  (step 1) and the `Change page: …` line that `c4builder feedback --as <change-id>` prints on
  stderr in step 3. No such line means the site has no change with this id: a typo, not built yet
  (the next rebuild adds it), or a CLI older than 0.10.0 — only then fall back to the build output:
  `find <distFolder> -path '*<change-id>*' -name '*.md' | head` (`distFolder` from `.c4builder`,
  `docs` by default), address `http://localhost:<port>/#/<path without .md>`.
- Argument is a page or a section: find it in the build output —
  `find <distFolder> -path '*<page>*' -name '*.md' | head`, address
  `http://localhost:<port>/#/<path without .md>`.
- No argument: the home page `http://localhost:<port>/`.

Give the link, remind in two lines what **Feedback** and **Question** do (see above) and say your
listener name: with several agents the human picks it in **Send to** on the review bar.

## 3. Wait

Start in the background (in Claude Code: Bash with `run_in_background`):

```bash
c4builder feedback --wait --as <name>
```

It exits when a batch arrives; its stdout is the batch. When `<name>` is a change of the site, it
first prints `Change page: http://localhost:<port>/#/change/<name>` on stderr — the link from step
2 confirmed by the server. Connecting turns the **Feedback** button on by itself, the server needs
no restart. Errors:

- `--as <name> is required` (exit code 2) — the name is missing or invalid: fix it and run again;
- `no c4builder site -w on …` (exit code 1) — no server or it crashed: back to step 1;
- `agent feedback is disabled on …` (exit code 1) — the server runs without `-w` or with
  `--no-agent`: ask the user to restart `c4builder --site -w`;
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
- Do not copy comments into the questions section: they are instructions to you, not questions
  for people.
- A comment that is unclear or debatable — ask in the chat instead of guessing; do the rest of the
  batch.
- After the edits report briefly in the chat what you did for each comment number. Then run
  `c4builder feedback --wait --as <name>` in the background again with the same name — batches
  wait in your mailbox.

## 5. Done

`Decision: approved` — nothing more to change: apply the comments of that batch, if any, give a
summary of the changes by file and stop waiting. Do not commit unless the user asks.
