## Dataset integrity

All assembly, CFG topology, metrics, string-presence information, and other compiler-derived facts displayed by the site must come from `web_data/`.

Never synthesize, invent, infer, simplify, or alter compiler output and present it as factual data. If required data is missing or inconsistent, surface the issue instead of fabricating a replacement.


## Interaction priority

The control-flow graph is the primary interactive explainer. Prioritize correct variant selection, responsive graph interaction, and clear complexity comparison over unrelated features or explanatory content.


## How this repo is put together

Plain HTML/CSS/TypeScript on Vite — no framework. `index.html` holds the whole
page structure; `main.ts` is the browser entry point and wires the real
dependencies; everything else lives in `src/`:

- `src/dataset.ts` — the only place that reaches `web_data/`. A configuration is
  resolved to a variant by **looking it up in `index.json`**, never by
  formatting an id or a file path, and a configuration with no entry throws
  instead of falling back to a neighbour. Fetched variants are cached.
- `src/app.ts` — the page controller. Takes its graph view as an argument
  (`makeGraph`) so the whole UI can be driven in jsdom without a canvas.
- `src/graph.ts` — Cytoscape.js + dagre. The only module that imports either.
- `src/asm.ts`, `src/highlight.ts` — colouring for text that came out of the
  dataset.

`web_data/` stays at that path. `vite.config.ts` copies it into `dist/` at build
time; nothing in it may be `import`ed, or all 256 variants land in the bundle.

### Rendering rules that follow from dataset integrity

- Highlighters are **classifiers**, never rewriters: the concatenated text of
  what they emit must equal their input, character for character. Build spans
  with `textContent`, never with markup strings.
- x86 text on screen is Capstone's own `mnemonic` and `op_str`. The structured
  `operands` array only chooses colours. If the two cannot be lined up, colour
  nothing rather than guess (`operandRanges` in `src/asm.ts`).
- The dataset records no mapping between LLVM blocks and machine blocks. The
  inspector says so, and states what the two CFGs actually look like, rather
  than implying a correspondence.
- Node placement is presentation and may be changed (`wrapWideRows` folds an
  over-wide dagre row so a flattened CFG is not a hairline). Nodes and edges
  themselves are never added, dropped, merged, or reordered.

## Checks

`pnpm check` = typecheck, build, oxlint, stylelint, vitest. Run it before
calling anything done; the specs read `dist/`, so a stale build fails them.

- `spec/dataset.test.ts` — every configuration maps to one variant; all 256
  files agree with `index.json` and with themselves. Node environment.
- `spec/app.test.ts` — the controller against the real markup and real data
  with a stubbed graph. jsdom environment (`// @vitest-environment jsdom`).
- `spec/page.test.ts` — the built markup's control and accessibility contract.
- `spec/viewports.test.ts` — the built site in a real Chromium at 1920×1080 and
  390×844. Skips itself when no system browser can be launched.
- `spec/harness.ts` — shared mounting helpers, not a test file.

Do not add `overflow-x: hidden` to `html` or `body`: it clamps `scrollWidth` and
makes the no-sideways-scroll checks pass without meaning anything.
