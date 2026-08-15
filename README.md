# The program didn't change

An interactive explainer for one idea: **obfuscation does not change what a
program does — it changes how hard its representation is to read.**

A twenty-line C program was compiled 256 times with Hikari LLVM 15, once for
every combination of four obfuscating transformations, four basic-block
splitting levels and four optimization levels. The site lets you switch those
transformations on and watch the same program's LLVM control-flow graph go from
seven blocks and eight edges to a hundred and fifty-six blocks and three hundred
and seven edges, while `source.c` sits behind a button, unchanged.

Every instruction, block, edge, byte count and string on the page is read from
the pre-generated dataset in `web_data/`. Nothing is disassembled, lowered, or
otherwise regenerated in the browser.

## Running it

```sh
mise install    # the tested Node and pnpm versions
pnpm install
pnpm dev        # local dev server
pnpm check      # typecheck, build, lint, and the full spec
pnpm build      # produce dist/, which is what deploys
```

`pnpm check` includes a real-browser layout pass at 1920×1080 and 390×844. It
uses whatever system Chromium or Chrome it can find and skips itself if there
is none, so it never blocks a build on a machine without a browser.

## What's where

- `index.html`, `styles.css` — the page and its dark analysis-tool surface.
- `main.ts` — browser entry point; builds the fetch-backed data loader.
- `src/` — dataset access, page controller, graph view, syntax colouring.
- `web_data/` — the supplied dataset: `index.json`, `source.c`, and 256 variant
  files. Only `index.json` and the selected variant are ever fetched.
- `spec/` — the shipped invariants plus this project's own contract tests.
- `CLAUDE.md` — the rules an agent working in this repo has to hold to,
  starting with dataset integrity.
- `PROCESS.md`, `reflections/` — the coursework write-up.

## The graph

Cytoscape.js draws it; dagre lays it out top-to-bottom, once per variant. One
addition on top of dagre: a row of blocks that all sit at the same control-flow
depth can be ten thousand pixels wide once flattening is on, which fits to an
unreadable hairline, so such a row is folded into several rows inside its own
band. That is placement only — every node and every edge in the dataset is on
screen, and none is invented.
