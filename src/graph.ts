// The control-flow graph view.
//
// Nodes and edges come straight from the selected variant's `llvm_cfg` — one
// element per record, no edges added, none dropped. Layout is computed once per
// variant with dagre (top-to-bottom, the reading order of control flow) and
// then left alone: panning and zooming never re-run it.

import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import type { Variant } from "./types.js";

cytoscape.use(dagre);

export interface GraphView {
  render(variant: Variant): void;
  select(nodeId: number | null, options?: { center?: boolean }): void;
  zoomBy(factor: number): void;
  fit(): void;
  resize(): void;
  destroy(): void;
}

export interface GraphViewOptions {
  container: HTMLElement;
  onSelect(nodeId: number | null): void;
  reducedMotion(): boolean;
}

/** How many of a block's instructions are previewed inside its box. */
const PREVIEW_LINES = 4;
const PREVIEW_WIDTH = 34;

/**
 * The text drawn inside a block: its label and count, then the first few of its
 * own IR instructions.
 *
 * This is a preview, not a listing — long lines are cut with an ellipsis and
 * the rest is summarised as "+N more", so at a distance a block reads as a
 * quantity of code rather than as something to be read. The full text of every
 * block is in the inspector, untruncated. The lines are the LLVM IR the node
 * actually carries; x86 is deliberately not shown here, because the dataset
 * records no mapping from an LLVM block to a machine block.
 */
function nodeText(node: { label: string; instructions: string[] }): string {
  const total = node.instructions.length;
  const head = `${node.label} · ${total}`;
  const shown = node.instructions.slice(0, PREVIEW_LINES).map((line) => {
    const trimmed = line.trim();
    return trimmed.length > PREVIEW_WIDTH
      ? `${trimmed.slice(0, PREVIEW_WIDTH - 1)}…`
      : trimmed;
  });
  const rest = total - shown.length;
  if (rest > 0) shown.push(`+${rest} more`);
  return [head, ...shown].join("\n");
}

const ROW_GAP = 18;
/** Rows this short are never folded: small graphs keep dagre's exact shape. */
const KEEP_INTACT = 8;

/**
 * Wraps over-wide rows of the dagre layout.
 *
 * Dagre puts every block at the same control-flow depth on one row. Control
 * flow flattening produces one dispatcher with ~150 siblings hanging off it, so
 * that row comes out ten thousand pixels wide and forty tall: fitted to the
 * stage, the whole graph collapses into a hairline that shows nothing. Folding
 * such a row into several rows inside its own band keeps every node, every edge
 * and the top-to-bottom depth order, and gives the picture a shape a person can
 * actually look at. Placement only — the graph itself is untouched.
 *
 * The fold width is not a constant: it is searched for the value that lets the
 * finished graph fill the most of this stage, so the same code serves a 1230px
 * desktop panel and a 360px phone.
 */
function wrapWideRows(cy: cytoscape.Core, stage: { w: number; h: number }): void {
  const rows = new Map<number, cytoscape.NodeSingular[]>();
  cy.nodes().forEach((node) => {
    const y = Math.round(node.position("y"));
    const bucket = rows.get(y);
    if (bucket) bucket.push(node);
    else rows.set(y, [node]);
  });

  const spanOf = (nodes: cytoscape.NodeSingular[]): number =>
    nodes.reduce((sum, node) => sum + node.outerWidth() + ROW_GAP, -ROW_GAP);

  const ordered = [...rows.entries()].sort(([a], [b]) => a - b);
  const foldable = ordered.filter(([, nodes]) => nodes.length > KEEP_INTACT);
  if (foldable.length === 0) return;

  const runs = foldable.map(([, nodes]) => spanOf(nodes));
  const widest = Math.max(...runs);
  const bandHeight =
    cy.nodes().reduce((max, node) => Math.max(max, node.outerHeight()), 0) +
    ROW_GAP;

  const positions = cy.nodes().map((node) => node.position("y"));
  const baseHeight =
    Math.max(...positions) - Math.min(...positions) + bandHeight;
  const fixedWidth = Math.max(
    0,
    ...ordered
      .filter(([, nodes]) => nodes.length <= KEEP_INTACT)
      .map(([, nodes]) => spanOf(nodes)),
  );

  // Search the fold width that maximises the eventual fit zoom.
  const stageW = stage.w > 0 ? stage.w : 1200;
  const stageH = stage.h > 0 ? stage.h : 600;
  const step = Math.max(40, widest / 80);
  let limit = widest;
  let best = -Infinity;
  for (let candidate = Math.min(320, widest); candidate <= widest; candidate += step) {
    const extra = runs.reduce(
      (sum, run) => sum + (Math.ceil(run / candidate) - 1) * bandHeight,
      0,
    );
    const width = Math.max(fixedWidth, Math.min(candidate, widest));
    const score = Math.min(stageW / width, stageH / (baseHeight + extra));
    if (score > best) {
      best = score;
      limit = candidate;
    }
  }
  if (limit >= widest) return;

  cy.batch(() => {
    let pushedDown = 0;
    for (const [y, nodes] of ordered) {
      nodes.sort((a, b) => a.position("x") - b.position("x"));
      const top = y + pushedDown;
      if (nodes.length <= KEEP_INTACT || spanOf(nodes) <= limit) {
        for (const node of nodes) node.position("y", top);
        continue;
      }

      const xs = nodes.map((node) => node.position("x"));
      const centre = (Math.min(...xs) + Math.max(...xs)) / 2;

      const lines: cytoscape.NodeSingular[][] = [];
      let line: cytoscape.NodeSingular[] = [];
      let used = 0;
      for (const node of nodes) {
        const width = node.outerWidth() + ROW_GAP;
        if (line.length > 0 && used + width > limit) {
          lines.push(line);
          line = [];
          used = 0;
        }
        line.push(node);
        used += width;
      }
      if (line.length > 0) lines.push(line);

      lines.forEach((entries, index) => {
        let x = centre - spanOf(entries) / 2;
        for (const node of entries) {
          node.position({ x: x + node.outerWidth() / 2, y: top + index * bandHeight });
          x += node.outerWidth() + ROW_GAP;
        }
      });
      pushedDown += (lines.length - 1) * bandHeight;
    }
  });
}

const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      shape: "round-rectangle",
      "background-color": "#16202c",
      "border-color": "#31485f",
      "border-width": 1,
      "border-style": "solid",
      label: "data(display)",
      "text-wrap": "wrap",
      "text-max-width": "250px",
      "text-valign": "center",
      "text-halign": "center",
      "text-justification": "left",
      color: "#9fb3c6",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "font-size": 9,
      "line-height": 1.35,
      // Below this the preview is a smudge; cytoscape drops it and draws the
      // boxes alone, which is the view you want when zoomed out anyway.
      "min-zoomed-font-size": 5,
      width: "label",
      height: "label",
      padding: "8px",
      "transition-property": "border-color, background-color, border-width",
      "transition-duration": 120,
    },
  },
  {
    selector: "node[?entry]",
    style: {
      "border-color": "#f2b45c",
      "border-width": 3,
      "border-style": "double",
      "background-color": "#1d2331",
      color: "#f6e3c4",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#66d0f5",
      "border-width": 3,
      "border-style": "solid",
      "background-color": "#1b3444",
      color: "#e8f6ff",
    },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      width: 1.3,
      "line-color": "#7c93a8",
      "target-arrow-color": "#7c93a8",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.75,
      "control-point-step-size": 26,
    },
  },
  {
    selector: 'edge[kind = "branch"]',
    style: {
      "line-color": "#7c93a8",
      "target-arrow-color": "#7c93a8",
      "line-style": "solid",
    },
  },
  {
    selector: 'edge[kind = "true"]',
    style: {
      "line-color": "#5ec27a",
      "target-arrow-color": "#5ec27a",
      "line-style": "solid",
      width: 1.6,
    },
  },
  {
    selector: 'edge[kind = "false"]',
    style: {
      "line-color": "#e0785d",
      "target-arrow-color": "#e0785d",
      "line-style": "dashed",
      "line-dash-pattern": [5, 4],
      width: 1.6,
    },
  },
  {
    selector: 'edge[kind = "case"]',
    style: {
      "line-color": "#5f9ff0",
      "target-arrow-color": "#5f9ff0",
      "line-style": "dotted",
      "line-dash-pattern": [2, 4],
    },
  },
  {
    selector: 'edge[kind = "default"]',
    style: {
      "line-color": "#b58cf0",
      "target-arrow-color": "#b58cf0",
      "line-style": "dashed",
      "line-dash-pattern": [10, 4],
    },
  },
  {
    selector: "edge.is-incident",
    style: {
      width: 2.4,
      "z-index": 20,
      opacity: 1,
    },
  },
];

export function createGraphView(options: GraphViewOptions): GraphView {
  const cy = cytoscape({
    container: options.container,
    style: STYLE,
    minZoom: 0.02,
    maxZoom: 3,
    boxSelectionEnabled: false,
    selectionType: "single",
    autoungrabify: true,
    textureOnViewport: true,
    pixelRatio: "auto",
  });

  // Whether the reader has taken the view over. Until they do, the graph stays
  // auto-fitted, so a panel above it collapsing or the window changing shape
  // re-fits instead of leaving the graph cropped. Once they have zoomed or
  // dragged, their view is theirs and a resize only keeps it centred.
  let userAdjusted = false;
  const markAdjusted = (): void => {
    userAdjusted = true;
  };
  options.container.addEventListener("wheel", markAdjusted, { passive: true });
  options.container.addEventListener("pointerdown", markAdjusted);

  cy.on("tap", "node", (event) => {
    options.onSelect(Number(event.target.id()));
  });
  cy.on("tap", (event) => {
    if (event.target === cy) options.onSelect(null);
  });

  function highlightIncident(): void {
    cy.edges().removeClass("is-incident");
    cy.$(":selected").connectedEdges().addClass("is-incident");
  }

  return {
    render(variant) {
      const { llvm_cfg: cfg } = variant;
      const elements: cytoscape.ElementDefinition[] = [];
      for (const node of cfg.nodes) {
        elements.push({
          group: "nodes",
          data: {
            id: String(node.id),
            display: nodeText(node),
            entry: node.id === cfg.entry_node_id ? 1 : 0,
          },
        });
      }
      cfg.edges.forEach((edge, i) => {
        elements.push({
          group: "edges",
          data: {
            id: `e${i}`,
            source: String(edge.source),
            target: String(edge.target),
            kind: edge.kind,
          },
        });
      });

      cy.startBatch();
      cy.elements().remove();
      cy.add(elements);
      cy.endBatch();

      cy.layout({
        name: "dagre",
        rankDir: "TB",
        ranker: "network-simplex",
        // Tighter than dagre's defaults: the boxes now carry a code preview,
        // so they are large and the gaps between them are what pushes a deep
        // chain off the bottom of the stage.
        nodeSep: 20,
        edgeSep: 10,
        rankSep: 28,
        animate: false,
        fit: false,
        padding: 30,
      } as cytoscape.LayoutOptions).run();

      const padding = 22;
      wrapWideRows(cy, {
        w: cy.width() - padding * 2,
        h: cy.height() - padding * 2,
      });
      userAdjusted = false;
      cy.fit(undefined, padding);
    },

    select(nodeId, opts) {
      cy.$(":selected").unselect();
      if (nodeId === null) {
        highlightIncident();
        return;
      }
      const node = cy.getElementById(String(nodeId));
      if (node.empty()) return;
      node.select();
      highlightIncident();
      if (opts?.center) {
        if (options.reducedMotion()) cy.center(node);
        else cy.animate({ center: { eles: node } }, { duration: 180 });
      }
    },

    zoomBy(factor) {
      userAdjusted = true;
      const next = Math.min(3, Math.max(0.02, cy.zoom() * factor));
      cy.zoom({
        level: next,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
    },

    fit() {
      userAdjusted = false;
      cy.fit(undefined, 22);
    },

    resize() {
      // A centre animation from a block selection can still be running when a
      // panel above the graph grows and shrinks the stage; letting it finish
      // after the re-fit leaves the graph parked off to one side.
      cy.stop();
      if (!userAdjusted) {
        cy.resize();
        cy.fit(undefined, 22);
        return;
      }
      // Their view: keep whatever is in the middle of it in the middle of it.
      const zoom = cy.zoom();
      const pan = cy.pan();
      const centre = {
        x: (cy.width() / 2 - pan.x) / zoom,
        y: (cy.height() / 2 - pan.y) / zoom,
      };
      cy.resize();
      cy.pan({
        x: cy.width() / 2 - centre.x * zoom,
        y: cy.height() / 2 - centre.y * zoom,
      });
    },

    destroy() {
      options.container.removeEventListener("wheel", markAdjusted);
      options.container.removeEventListener("pointerdown", markAdjusted);
      cy.destroy();
    },
  };
}
