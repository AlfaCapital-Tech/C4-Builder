# Wireflow reference

[Wireflow](https://github.com/vanila-io/wireflow) is an open-source user-flow editor: screen
cards built from ready-made templates, notes, groups and transitions. c4builder renders its JSON
export **at build time** with its own renderer — no browser, no network, no extra packages. The
screen templates (125, MIT) ship with the package in `vendor/wireflow/`; text is set in the
bundled Nimbus Sans, so the SVG is identical on every machine.

## When wireflow

- **Screens and transitions of a user flow** (sign-in, checkout, onboarding) drawn by a person in
  the editor — wireflow.
- **C4 model** — PlantUML with the C4 stdlib ([diagrams.md](diagrams.md)); **processes with
  pools and lanes** — BPMN ([bpmn.md](bpmn.md)); **flows and sequences written as text** —
  mermaid ([mermaid.md](mermaid.md)).

## Source

- A file named `wireflow.json` (the editor's export name) or ending in `.wireflow.json`
  (case-insensitive) in a page folder. Other `.json` files are not diagrams — they are copied
  as regular files.
- The image is named without the suffix: `checkout.wireflow.json` → `checkout.svg` (or `.png`
  with `diagramFormat: png`), `wireflow.json` → `wireflow.svg`. `checkout.wireflow.json` and
  `checkout.puml` in one folder collide on the image name.
- Attached to the page like any diagram, or placed inline with `![title](checkout.wireflow.json)`.
- There is no ```` ```wireflow ```` block: wireflow is file-only.
- Keep the file an editor export: the person can open it in Wireflow, edit and save it back. When
  you edit it by hand, keep the structure:
  `{"format": "wireflow", "version": 4, "diagram": {"nodes": [...], "edges": [...]}}`. Nodes are
  `flow` (a screen card: `data.graphicId` from the template catalog, `data.headerText`,
  `data.showHeader`), `note` (`width`, `height`, `data.text`) and `group` (`data.label`; children
  set `parentId` and positions relative to the group). Edges have `source`, `target`, optional
  `type` (`step`, `smoothstep`, default — a curve), `label`, `markerEnd`, `style`.
  Template ids are listed in `vendor/wireflow/graphics.json` of the installed package.

## Check

```bash
c4builder check "src/7 Wireflow Example/checkout.wireflow.json"
```

Same validation and rendering as the build. Each problem is one line with the element id:
`✗ <file>: <problem>`, exit code 1. Warnings (`⚠ <file>: …`) keep exit code 0.

| Message | Fix |
|---|---|
| old format (version 1 or no `format`) | open the file in the current Wireflow editor and export it again |
| unsupported version (newer than 4) | the editor is newer than this c4builder — run `c4builder update` |
| edge to a missing node / `parentId` to a missing group / duplicate `id` | fix the reference or the id named in the message |
| unknown screen template (warning) | use a `graphicId` from the catalog; until then the card is a placeholder |
| external image URL (warning) | embed the image as a `data:` URL — the build never fetches it |
| WebP image in PNG output (warning) | use a PNG or JPEG image, or `diagramFormat: svg` |

## Limits

- Not pixel-identical to the editor: a different font, the same geometry and colours.
- Estimates, rates and stages (`settings`) and the estimate badge are not drawn.
- `generateLocalImages: false` does not work with wireflow (no online renderer) — the build stops.
- In `llms-full.txt` the source is a `json` block with embedded images replaced by
  `"<embedded image>"`.
