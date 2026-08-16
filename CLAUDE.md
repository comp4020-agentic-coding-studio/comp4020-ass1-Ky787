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
  Two constants, deliberately distinct: `BASELINE_CONFIG` is the clean **O0**
  reference the complexity summary counts up from, and `INITIAL_CONFIG` is what
  the controls open on and Reset returns to — the same clean build at **O3**.
  Because they differ, boot fetches two variants (the selected one and the
  baseline) so the summary has a left-hand number on first paint.
- `src/app.ts` — the page controller. Takes its graph view as an argument
  (`makeGraph`) so the whole UI can be driven in jsdom without a canvas. It also
  owns the x86/IR view switch: `VIEWS` names each view's title, edge kinds and
  instruction unit, and `machineModel`/`llvmModel` project the chosen CFG onto
  the neutral `GraphModel`.
- `src/graph.ts` — Cytoscape.js + dagre. The only module that imports either.
  It is told nothing about LLVM or x86 — it draws whatever `GraphModel` it is
  handed, so both views share one renderer.
- `src/asm.ts`, `src/highlight.ts` — colouring for text that came out of the
  dataset: x86 in the disassembly pane, C in the source pane. Nothing colours
  IR any more — the IR on screen is the graph's node previews, which cytoscape
  draws as plain label text.
- `src/command.ts` — the **one** module that does not read from `web_data/`:
  the dataset holds the compiled objects, so the `clang` line is assembled from
  the six controls. The switch spellings are verified against the archived
  Hikari documentation and the ChandHsu/Hikari-LLVM15 fork this dataset was
  generated with, so they may be stated plainly. It must stay a pure function of
  the configuration: no flag may appear that no control asked for, and no seed
  flag may be invented — the seed is fixed at 12345, but nothing records which
  switch carried it. `spec/command.test.ts` holds that line.
- `src/hints.ts`, `src/annotations.ts` — the other page-authored text: the
  question-mark explanations, and the plain-English `OVERVIEW` and line notes
  beside `source.c`.
  Both explain general compiler ideas; neither states anything about the
  dataset. The notes are **never merged into the code** — `annotate` returns the
  source line untouched and the note separately, the code goes in a `.c-code`
  span and the note in a `.c-note` one, and `spec/explainers.test.ts` asserts
  the `.c-code` spans still concatenate to the file byte for byte. Notes are
  matched on a snippet rather than a line number, and a snippet that matches
  nothing is surfaced in the pane's caption rather than silently dropped.

`web_data/` stays at that path. `vite.config.ts` copies it into `dist/` at build
time; nothing in it may be `import`ed, or all 256 variants land in the bundle.

### Rendering rules that follow from dataset integrity

- Highlighters are **classifiers**, never rewriters: the concatenated text of
  what they emit must equal their input, character for character. Build spans
  with `textContent`, never with markup strings.
- x86 text on screen is Capstone's own `mnemonic` and `op_str`. The structured
  `operands` array only chooses colours. If the two cannot be lined up, colour
  nothing rather than guess (`operandRanges` in `src/asm.ts`).
- The dataset records no mapping between LLVM blocks and machine blocks.
  Nothing on the page lines one CFG up against the other, and the technical
  details in the footer say so outright, beside the two block counts.
- Node placement is presentation and may be changed (`wrapWideRows` folds an
  over-wide dagre row so a flattened CFG is not a hairline). Nodes and edges
  themselves are never added, dropped, merged, or reordered.
- The code preview drawn inside each graph box is that node's **own** code,
  truncated with a visible ellipsis and a "+N more" tail. The graph has two
  views and each draws only what its own CFG holds: the machine view draws
  `machine_cfg`, whose nodes carry real x86, and the LLVM view draws `llvm_cfg`,
  whose nodes carry IR. Because there is no LLVM-to-machine mapping in the
  dataset, x86 must never be drawn on an LLVM block or vice versa — that would
  be a claim the data cannot make. Selecting a block highlights it and
  describes it to a screen reader; there is no detail panel behind it, so the
  box has to carry enough of the code to be worth reading.
- Labels never disappear as the reader zooms out (`min-zoomed-font-size: 0`).
  A flattened CFG is unreadably small at fit zoom, and that *is* the finding —
  dropping the text would hide it behind a rendering optimisation.

## Checks

`pnpm check` = typecheck, build, oxlint, stylelint, vitest. Run it before
calling anything done; the specs read `dist/`, so a stale build fails them.

- `spec/dataset.test.ts` — every configuration maps to one variant; all 256
  files agree with `index.json` and with themselves. Node environment.
- `spec/app.test.ts` — the controller against the real markup and real data
  with a stubbed graph. jsdom environment (`// @vitest-environment jsdom`).
- `spec/page.test.ts` — the built markup's control and accessibility contract.
- `spec/command.test.ts` — the build command against every configuration.
- `spec/explainers.test.ts` — the hints and the source notes: that the notes
  leave the code exactly as the dataset has it, that a drifted source is
  reported rather than mis-annotated, and that a hint inside a `<label>` never
  flips the switch it is explaining.
- `spec/viewports.test.ts` — the built site in a real Chromium at 1920×1080 and
  390×844, including that the graph owns the lower viewport and the controls
  stay pinned above it. Skips itself when no system browser can be launched.
- `spec/harness.ts` — shared mounting helpers, not a test file.

The page is two screens: a hero (headline, pinned controls, build command,
`source.c` beside the current disassembly) and a full-viewport analysis stage
holding two things and no others — the metrics, then the graph across the full
width. Nothing sits beside the graph and nothing sits above it but the metrics;
`spec/page.test.ts` asserts the stage has exactly those two children, so a new
panel cannot quietly take the graph's height back. The graph's own header
carries the x86 / LLVM IR switch beside zoom and fit. The controls are `position: sticky`, and the stage
sizes itself with `calc(100dvh - var(--dock-h))` — `--dock-h` is measured from
the real dock in `app.ts`, so changing the controls' height needs no CSS edit.

Every control that has a clean end and a hard-to-read end runs along one
intensity ramp (`--scale-0` green … `--scale-3` red), left to right, so the dock
reads as a single scale: a switch is green off and red on, and the two
`.segmented--scale` groups tick each step in its own phase colour. That is why
optimization is listed **O3 first** — it puts the clean end of both scales on
the same side. The view switch is `.segmented--view` and stays off the ramp:
x86 and IR are two ways of looking, not two amounts of obfuscation.

Colour is never the only signal — each switch also says ON or OFF and moves its
thumb, and each step of a scale keeps its own label and position, because
red/green is exactly the pair a colour-blind reader cannot separate.
`spec/viewports.test.ts` holds both halves of that.

Do not add `overflow-x: hidden` to `html` or `body`: it clamps `scrollWidth` and
makes the no-sideways-scroll checks pass without meaning anything.
