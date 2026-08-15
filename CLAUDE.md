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
- `src/command.ts` — the **one** module that does not read from `web_data/`:
  the dataset holds the compiled objects, so the `clang` line is assembled from
  the six controls. The switch spellings are verified against the archived
  Hikari documentation and the ChandHsu/Hikari-LLVM15 fork this dataset was
  generated with, so they may be stated plainly. It must stay a pure function of
  the configuration: no flag may appear that no control asked for, and no seed
  flag may be invented — the seed is fixed at 12345, but nothing records which
  switch carried it. `spec/command.test.ts` holds that line.

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
- `spec/command.test.ts` — the reconstructed build command against every
  configuration.
- `spec/viewports.test.ts` — the built site in a real Chromium at 1920×1080 and
  390×844, including that the graph owns the lower viewport and the controls
  stay pinned above it. Skips itself when no system browser can be launched.
- `spec/harness.ts` — shared mounting helpers, not a test file.

The page is two screens: a hero (headline, pinned controls, build command,
`source.c` beside the current disassembly) and a full-viewport analysis stage
(metrics plus the graph). The controls are `position: sticky`, and the stage
sizes itself with `calc(100dvh - var(--dock-h))` — `--dock-h` is measured from
the real dock in `app.ts`, so changing the controls' height needs no CSS edit.

Do not add `overflow-x: hidden` to `html` or `body`: it clamps `scrollWidth` and
makes the no-sideways-scroll checks pass without meaning anything.
