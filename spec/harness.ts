// Test harness: mounts the real page controller against the real dataset in a
// jsdom document, with the graph view replaced by a spy.
//
// Everything the controller reads comes from web_data/ on disk and the built
// dist/index.html, so these tests fail if either the markup contract or the
// data mapping drifts.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp, type App } from "../src/app.js";
import { Dataset, type DataLoader } from "../src/dataset.js";
import type { GraphView, GraphViewOptions } from "../src/graph.js";
import type { Variant, VariantConfig } from "../src/types.js";

const DATA_DIR = resolve("web_data");
const PAGE = resolve("dist/index.html");

export interface LoaderControl {
  loader: DataLoader;
  /** Every path asked for, in order. */
  requests: string[];
  /** Paths that should reject instead of resolving. */
  failures: Set<string>;
  /** Extra milliseconds before a path resolves, for ordering tests. */
  delays: Map<string, number>;
}

export function makeLoader(): LoaderControl {
  const control: LoaderControl = {
    requests: [],
    failures: new Set(),
    delays: new Map(),
    loader: {
      async json(relativePath) {
        return JSON.parse(await control.loader.text(relativePath)) as unknown;
      },
      async text(relativePath) {
        control.requests.push(relativePath);
        const wait = control.delays.get(relativePath);
        if (wait !== undefined) {
          await new Promise((done) => setTimeout(done, wait));
        }
        if (control.failures.has(relativePath)) {
          throw new Error(`HTTP 404 for web_data/${relativePath}`);
        }
        return readFileSync(join(DATA_DIR, relativePath), "utf8");
      },
    },
  };
  return control;
}

export interface GraphSpy {
  readonly rendered: Variant[];
  readonly selections: (number | null)[];
  readonly zoomFactors: number[];
  fits: number;
  resizes: number;
  destroyed: boolean;
  /** Simulates a click on a node in the rendered graph. */
  clickNode(nodeId: number | null): void;
  lastRendered(): Variant | undefined;
}

/** Loads the *built* page into the jsdom document, minus its scripts. */
export function loadPage(): void {
  const html = readFileSync(PAGE, "utf8").replace(
    /<script\b[\s\S]*?<\/script>/gi,
    "",
  );
  document.open();
  document.write(html);
  document.close();
}

export interface Mounted {
  app: App;
  graph: GraphSpy;
  control: LoaderControl;
  dataset: Dataset;
}

export async function mountApp(control = makeLoader()): Promise<Mounted> {
  loadPage();

  const spy: GraphSpy = {
    rendered: [],
    selections: [],
    zoomFactors: [],
    fits: 0,
    resizes: 0,
    destroyed: false,
    clickNode: () => {
      throw new Error("graph not mounted yet");
    },
    lastRendered() {
      return this.rendered.at(-1);
    },
  };

  const makeGraph = (options: GraphViewOptions): GraphView => {
    spy.clickNode = (nodeId) => options.onSelect(nodeId);
    return {
      render: (variant) => {
        spy.rendered.push(variant);
      },
      select: (nodeId) => {
        spy.selections.push(nodeId);
      },
      zoomBy: (factor) => {
        spy.zoomFactors.push(factor);
      },
      fit: () => {
        spy.fits += 1;
      },
      resize: () => {
        spy.resizes += 1;
      },
      destroy: () => {
        spy.destroyed = true;
      },
    };
  };

  const dataset = await Dataset.open(control.loader);
  const app = await createApp({
    doc: document,
    dataset,
    makeGraph,
    reducedMotion: () => true,
  });

  return { app, graph: spy, control, dataset };
}

// --------------------------------------------------------------- driving ---

export function el<T extends Element>(testId: string): T {
  const found = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`no element with data-testid="${testId}"`);
  return found;
}

function fire(input: HTMLElement, type = "change"): void {
  input.dispatchEvent(new window.Event(type, { bubbles: true }));
}

/** Sets one control the way a user would, then waits for the load to settle. */
export async function setControls(
  app: App,
  changes: Partial<VariantConfig>,
): Promise<void> {
  for (const [key, value] of Object.entries(changes)) {
    if (key === "optimization") {
      const radio = document.querySelector<HTMLInputElement>(
        `input[name="opt"][value="${String(value)}"]`,
      );
      if (!radio) throw new Error(`no optimization control for ${String(value)}`);
      radio.checked = true;
      fire(radio);
    } else if (key === "split_level") {
      const radio = document.querySelector<HTMLInputElement>(
        `input[name="split"][value="${String(value)}"]`,
      );
      if (!radio) throw new Error(`no split control for ${String(value)}`);
      radio.checked = true;
      fire(radio);
    } else {
      const box = document.querySelector<HTMLInputElement>(
        `[data-transform="${key}"]`,
      );
      if (!box) throw new Error(`no transform control for ${key}`);
      box.checked = Boolean(value);
      fire(box);
    }
  }
  await app.ready();
}

export function click(element: Element): void {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

export function press(element: Element, key: string): void {
  element.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

export function numberIn(root: Element, role: string): number | null {
  const text = root.querySelector(`[data-role="${role}"]`)?.textContent ?? "";
  if (text.trim() === "—") return null;
  return Number(text.replace(/[^\d.-]/g, ""));
}

export function metricCell(name: string): HTMLElement {
  const cell = el("metrics").querySelector<HTMLElement>(
    `[data-metric="${name}"]`,
  );
  if (!cell) throw new Error(`no metric cell "${name}"`);
  return cell;
}
