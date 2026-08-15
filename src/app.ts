// The page controller: reads the controls, resolves them to a dataset variant,
// loads exactly that variant, and paints the metrics, strings, graph and
// inspector from it.
//
// The graph view is injected rather than imported so the whole controller can
// be driven in a DOM without a canvas.

import { instructionsByAddress, renderInstruction } from "./asm.js";
import {
  BASELINE_CONFIG,
  Dataset,
  DatasetError,
  OPTIMIZATION_LEVELS,
  SPLIT_LEVELS,
} from "./dataset.js";
import { highlightC, highlightIr } from "./highlight.js";
import type { GraphView, GraphViewOptions } from "./graph.js";
import type {
  BooleanTransform,
  IndexVariant,
  Instruction,
  LlvmNode,
  OptimizationLevel,
  SplitLevel,
  Variant,
  VariantConfig,
} from "./types.js";

/** Fixed experiment parameters for this dataset, quoted from the brief. */
const EXPERIMENT = { toolchain: "Hikari LLVM 15", seed: "12345" } as const;

const TRANSFORMS: { key: BooleanTransform; label: string }[] = [
  { key: "bcf", label: "Bogus Control Flow" },
  { key: "flattening", label: "Control Flow Flattening" },
  { key: "substitution", label: "Instruction Substitution" },
  { key: "string_encryption", label: "String Encryption" },
];

const METRIC_ROWS = [
  { cell: "instructions", key: "instruction_count", label: "x86 instructions" },
  { cell: "blocks", key: "llvm_basic_block_count", label: "LLVM basic blocks" },
  { cell: "edges", key: "llvm_cfg_edge_count", label: "LLVM CFG edges" },
  { cell: "bytes", key: "main_byte_size", label: "bytes of main" },
] as const;

export interface AppDeps {
  doc: Document;
  dataset: Dataset;
  makeGraph(options: GraphViewOptions): GraphView;
  reducedMotion?(): boolean;
}

export interface App {
  /** The configuration currently expressed by the controls. */
  config(): VariantConfig;
  /** The variant JSON on screen, or null while erroring/loading the first one. */
  variant(): Variant | null;
  /** Resolves once the in-flight variant load has settled. */
  ready(): Promise<void>;
  /** Selects a block as a click on it would. */
  selectBlock(nodeId: number | null): void;
  selectedBlock(): number | null;
  destroy(): void;
}

function must<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

function hex(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(4, "0")}`;
}

function clear(node: Element): void {
  node.replaceChildren();
}

function countPlaintext(variant: Variant): number {
  return Object.values(variant.watched_plaintext_strings).filter(Boolean).length;
}

/**
 * True when the two CFGs in this variant happen to carry the same block ids and
 * the same edges. It is a statement about the data, not a claimed mapping.
 */
function cfgsCoincide(variant: Variant): boolean {
  const llvm = variant.llvm_cfg;
  const machine = variant.machine_cfg;
  if (llvm.nodes.length !== machine.nodes.length) return false;
  const machineIds = new Set(machine.nodes.map((n) => n.id));
  if (llvm.nodes.some((n) => !machineIds.has(n.id))) return false;
  const key = (edges: { source: number; target: number }[]): string =>
    edges
      .map((e) => `${e.source}>${e.target}`)
      .sort()
      .join(",");
  return key(llvm.edges) === key(machine.edges);
}

export async function createApp(deps: AppDeps): Promise<App> {
  const { doc, dataset } = deps;
  const reducedMotion =
    deps.reducedMotion ??
    (() =>
      typeof doc.defaultView?.matchMedia === "function" &&
      doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ------------------------------------------------------------- elements ---
  const variantLabel = must(doc, '[data-testid="variant-id"]');
  const resetButton = must<HTMLButtonElement>(doc, '[data-testid="reset"]');
  const metricsList = must(doc, '[data-testid="metrics"]');
  const graphCounts = must(doc, '[data-testid="graph-counts"]');
  const graphCanvas = must<HTMLElement>(doc, '[data-testid="graph"]');
  const graphStatus = must(doc, '[data-testid="graph-status"]');
  const overlay = must<HTMLElement>(doc, "[data-role='overlay']");
  const stringsList = must(doc, '[data-testid="strings"]');
  const stringsNote = must(doc, '[data-testid="strings-note"]');
  const inspector = must<HTMLElement>(doc, '[data-testid="inspector"]');
  const inspectorTitle = must<HTMLElement>(inspector, ".panel__title");
  const inspectorEmpty = must<HTMLElement>(inspector, "[data-role='empty']");
  const inspectorBody = must<HTMLElement>(inspector, "[data-role='body']");
  const blockLabel = must(inspector, "[data-role='block-label']");
  const blockEntry = must<HTMLElement>(inspector, "[data-role='block-entry']");
  const inspectorMeta = must(doc, '[data-testid="inspector-meta"]');
  const irCode = must(inspector, "[data-role='ir']");
  const asmCode = must(inspector, "[data-role='asm']");
  const asmProvenance = must(doc, '[data-testid="asm-provenance"]');
  const mblockSelect = must<HTMLSelectElement>(doc, '[data-testid="mblock"]');
  const techList = must(doc, "[data-role='tech-list']");
  const sourceDialog = must<HTMLDialogElement>(doc, '[data-testid="source-dialog"]');
  const sourceCode = must(doc, '[data-testid="source"] code');
  const tabs = [
    must<HTMLButtonElement>(doc, '[data-testid="tab-ir"]'),
    must<HTMLButtonElement>(doc, '[data-testid="tab-asm"]'),
  ];

  const switches = new Map<BooleanTransform, HTMLInputElement>();
  for (const { key } of TRANSFORMS) {
    switches.set(key, must<HTMLInputElement>(doc, `[data-transform="${key}"]`));
  }
  const splitInputs = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[name="split"]'),
  );
  const optInputs = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[name="opt"]'),
  );

  // ---------------------------------------------------------------- state ---
  const baselineEntry = dataset.baseline;
  let baselineVariant: Variant | null = null;
  let currentEntry: IndexVariant | null = null;
  let currentVariant: Variant | null = null;
  let selectedNode: number | null = null;
  let addressIndex = new Map<number, Instruction>();
  let sequence = 0;
  // Every scheduled update, until it settles. A later control change often
  // resolves to the variant already being fetched and returns immediately, so
  // "is anything still loading" cannot be answered by the most recent call.
  const active = new Set<Promise<void>>();
  let destroyed = false;

  const graph = deps.makeGraph({
    container: graphCanvas,
    onSelect: (nodeId) => selectBlock(nodeId, { reveal: true, center: false }),
    reducedMotion,
  });

  // -------------------------------------------------------------- controls ---
  function readConfig(): VariantConfig {
    const split = splitInputs.find((input) => input.checked)?.value ?? "0";
    const opt = optInputs.find((input) => input.checked)?.value ?? "O0";
    return {
      optimization: (OPTIMIZATION_LEVELS.find((o) => o === opt) ??
        "O0") as OptimizationLevel,
      bcf: switches.get("bcf")!.checked,
      flattening: switches.get("flattening")!.checked,
      substitution: switches.get("substitution")!.checked,
      string_encryption: switches.get("string_encryption")!.checked,
      split_level: (SPLIT_LEVELS.find((s) => String(s) === split) ??
        0) as SplitLevel,
    };
  }

  function writeConfig(config: VariantConfig): void {
    for (const { key } of TRANSFORMS) switches.get(key)!.checked = config[key];
    for (const input of splitInputs) {
      input.checked = input.value === String(config.split_level);
    }
    for (const input of optInputs) {
      input.checked = input.value === config.optimization;
    }
    paintSwitchStates();
  }

  function paintSwitchStates(): void {
    for (const input of switches.values()) {
      const row = input.closest(".switch");
      const state = row?.querySelector(".switch__state");
      if (state) state.textContent = input.checked ? "ON" : "OFF";
      row?.setAttribute("data-on", String(input.checked));
    }
  }

  // --------------------------------------------------------------- metrics ---
  function paintMetric(
    cell: string,
    label: string,
    base: number | null,
    current: number | null,
    max: number,
    unit = "",
  ): void {
    const li = metricsList.querySelector(`[data-metric="${cell}"]`);
    if (!li) return;
    const set = (role: string, text: string): void => {
      const el = li.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };
    const fmt = (n: number | null): string =>
      n === null ? "—" : n.toLocaleString("en-AU");

    set("base", fmt(base));
    set("current", fmt(current));

    let delta = "";
    let direction = "flat";
    if (base !== null && current !== null) {
      if (current === base) {
        delta = "unchanged";
      } else {
        direction = current > base ? "up" : "down";
        const arrow = current > base ? "▲" : "▼";
        const ratio = base === 0 ? null : current / base;
        delta =
          ratio !== null && (ratio >= 2 || ratio <= 0.5)
            ? `${arrow} ×${ratio.toFixed(ratio >= 10 ? 0 : 1)}`
            : `${arrow} ${current > base ? "+" : "−"}${Math.abs(current - base).toLocaleString("en-AU")}`;
      }
    }
    set("delta", delta || " ");
    li.setAttribute("data-direction", direction);

    const fill = li.querySelector<HTMLElement>('[data-role="fill"]');
    if (fill) {
      const pct = current === null || max <= 0 ? 0 : (current / max) * 100;
      fill.style.width = `${Math.max(current ? 1.5 : 0, Math.min(100, pct))}%`;
    }

    const sr = li.querySelector('[data-role="sr"]');
    if (sr) {
      sr.textContent =
        base === null || current === null
          ? `${label}: unavailable.`
          : `${label}: ${base}${unit} in the clean O0 baseline, ${current}${unit} in the selected variant` +
            (current === base
              ? ", unchanged."
              : `, ${current > base ? "up" : "down"} by ${Math.abs(current - base)}.`);
    }
  }

  function paintMetrics(variant: Variant | null): void {
    for (const row of METRIC_ROWS) {
      paintMetric(
        row.cell,
        row.label,
        baselineEntry.metrics[row.key],
        variant ? variant.metrics[row.key] : null,
        dataset.maxima[row.key],
      );
    }
    const watched = variant
      ? Object.keys(variant.watched_plaintext_strings).length
      : 0;
    paintMetric(
      "strings",
      "watched plaintext strings",
      baselineVariant ? countPlaintext(baselineVariant) : null,
      variant ? countPlaintext(variant) : null,
      watched || 1,
    );
  }

  // --------------------------------------------------------------- strings ---
  function paintStrings(variant: Variant | null): void {
    clear(stringsList);
    if (!variant) {
      stringsNote.textContent = "";
      return;
    }
    const entries = Object.entries(variant.watched_plaintext_strings);
    for (const [text, present] of entries) {
      const li = doc.createElement("li");
      li.className = "string";
      li.setAttribute("data-present", String(present));
      const code = doc.createElement("code");
      code.className = "string__text";
      code.textContent = JSON.stringify(text);
      const state = doc.createElement("span");
      state.className = "string__state";
      state.textContent = present ? "PLAINTEXT" : "ABSENT";
      li.append(code, state);
      stringsList.append(li);
    }
    const present = entries.filter(([, ok]) => ok).length;
    const total = entries.length;
    if (present === total) {
      stringsNote.textContent = `All ${total} watched literals appear verbatim in the compiled object.`;
    } else if (present === 0) {
      stringsNote.textContent = variant.config.string_encryption
        ? `String Encryption is on: none of the ${total} watched literals appear in the compiled object.`
        : `None of the ${total} watched literals appear in the compiled object.`;
    } else {
      stringsNote.textContent = `${present} of ${total} watched literals appear in the compiled object.`;
    }
  }

  // ------------------------------------------------------------- inspector ---
  function edgeChips(
    variant: Variant,
    nodeId: number,
    outgoing: boolean,
  ): HTMLElement {
    const dd = doc.createElement("dd");
    const labels = new Map(variant.llvm_cfg.nodes.map((n) => [n.id, n.label]));
    const matches = variant.llvm_cfg.edges.filter((edge) =>
      outgoing ? edge.source === nodeId : edge.target === nodeId,
    );
    if (matches.length === 0) {
      dd.append(span2("edge-chip edge-chip--none", "none"));
      return dd;
    }
    for (const edge of matches) {
      const other = outgoing ? edge.target : edge.source;
      const chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "edge-chip";
      chip.setAttribute("data-kind", edge.kind);
      chip.textContent = `${outgoing ? "→" : "←"} ${labels.get(other) ?? other} · ${edge.kind}`;
      chip.addEventListener("click", () => {
        selectBlock(other, { reveal: true, center: true });
      });
      dd.append(chip);
    }
    return dd;
  }

  function span2(className: string, text: string): HTMLElement {
    const el = doc.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  function metaRow(term: string, value: Node | string): void {
    const dt = doc.createElement("dt");
    dt.textContent = term;
    inspectorMeta.append(dt);
    if (typeof value === "string") {
      const dd = doc.createElement("dd");
      dd.textContent = value;
      inspectorMeta.append(dd);
    } else {
      inspectorMeta.append(value);
    }
  }

  function paintIr(node: LlvmNode): void {
    clear(irCode);
    node.instructions.forEach((line, i) => {
      const row = doc.createElement("span");
      row.className = "ir-line";
      row.append(highlightIr(line));
      irCode.append(row);
      if (i < node.instructions.length - 1) irCode.append("\n");
    });
  }

  function paintMachineBlock(variant: Variant, machineId: number): void {
    clear(asmCode);
    const node = variant.machine_cfg.nodes.find((n) => n.id === machineId);
    if (!node) {
      asmCode.textContent = "No machine block with that id in this variant.";
      return;
    }
    let missing = 0;
    node.instruction_addresses.forEach((address, i) => {
      const instruction = addressIndex.get(address);
      if (!instruction) {
        missing += 1;
        return;
      }
      asmCode.append(renderInstruction(instruction));
      if (i < node.instruction_addresses.length - 1) asmCode.append("\n");
    });
    if (missing > 0) {
      asmCode.append(
        "\n",
        span2(
          "asm-warn",
          `; ${missing} address(es) in this block have no instruction in the dataset`,
        ),
      );
    }
  }

  function paintMachineTab(variant: Variant, llvmNodeId: number): void {
    const machine = variant.machine_cfg;
    const coincide = cfgsCoincide(variant);
    const target =
      coincide && machine.nodes.some((n) => n.id === llvmNodeId)
        ? llvmNodeId
        : machine.entry_node_id;

    asmProvenance.textContent = coincide
      ? `The machine CFG here carries the same block ids and the same edges as the LLVM CFG (${machine.nodes.length} blocks, ${machine.edges.length} edges); machine block ${target} is shown. The dataset records no explicit LLVM-to-machine mapping.`
      : `The machine CFG here has ${machine.nodes.length} blocks and ${machine.edges.length} edges against ${variant.llvm_cfg.nodes.length} LLVM blocks, and the dataset records no mapping between them — pick a machine block to read.`;

    clear(mblockSelect);
    for (const node of machine.nodes) {
      const option = doc.createElement("option");
      option.value = String(node.id);
      option.textContent = `block ${node.id} · ${hex(node.start)}–${hex(node.end)} · ${node.instruction_addresses.length} instr`;
      if (node.id === target) option.selected = true;
      mblockSelect.append(option);
    }
    paintMachineBlock(variant, target);
  }

  function clearInspector(): void {
    inspector.setAttribute("data-open", "false");
    inspector.setAttribute("data-selected", "false");
    inspectorEmpty.hidden = false;
    inspectorBody.hidden = true;
  }

  function paintInspector(): void {
    const variant = currentVariant;
    if (!variant || selectedNode === null) {
      clearInspector();
      return;
    }
    const node = variant.llvm_cfg.nodes.find((n) => n.id === selectedNode);
    if (!node) {
      clearInspector();
      return;
    }

    inspector.setAttribute("data-selected", "true");
    inspectorEmpty.hidden = true;
    inspectorBody.hidden = false;
    blockLabel.textContent = node.label;
    blockEntry.hidden = node.id !== variant.llvm_cfg.entry_node_id;

    clear(inspectorMeta);
    metaRow("IR instructions", String(node.instructions.length));
    metaRow("Layout order", String(node.order));
    metaRow("Predecessors", edgeChips(variant, node.id, false));
    metaRow("Successors", edgeChips(variant, node.id, true));

    paintIr(node);
    paintMachineTab(variant, node.id);
  }

  function selectBlock(
    nodeId: number | null,
    options: { reveal: boolean; center: boolean },
  ): void {
    selectedNode = nodeId;
    graph.select(nodeId, { center: options.center });
    paintInspector();
    if (nodeId !== null && currentVariant) {
      const node = currentVariant.llvm_cfg.nodes.find((n) => n.id === nodeId);
      const out = currentVariant.llvm_cfg.edges.filter(
        (e) => e.source === nodeId,
      ).length;
      graphStatus.textContent = node
        ? `Block ${node.label}, ${node.instructions.length} IR instructions, ${out} outgoing edge${out === 1 ? "" : "s"}.`
        : "";
      if (options.reveal) {
        inspector.setAttribute("data-open", "true");
        if (isSheet()) inspectorTitle.focus();
      }
    }
  }

  function isSheet(): boolean {
    const view = doc.defaultView;
    return (
      typeof view?.matchMedia === "function" &&
      view.matchMedia("(max-width: 899px)").matches
    );
  }

  function closeInspector(): void {
    const wasSheet = isSheet();
    selectBlock(null, { reveal: false, center: false });
    inspector.setAttribute("data-open", "false");
    if (wasSheet) graphCanvas.focus();
  }

  // ------------------------------------------------------------------ tech ---
  function paintTech(entry: IndexVariant | null, variant: Variant | null): void {
    clear(techList);
    const row = (term: string, value: string): void => {
      const dt = doc.createElement("dt");
      dt.textContent = term;
      const dd = doc.createElement("dd");
      dd.textContent = value;
      techList.append(dt, dd);
    };
    row("Toolchain", EXPERIMENT.toolchain);
    row("Fixed dataset seed", EXPERIMENT.seed);
    if (!entry) {
      row("Selected variant", "unavailable");
      return;
    }
    const enabled = TRANSFORMS.filter(({ key }) => entry.config[key]).map(
      ({ label }) => label,
    );
    row("Optimization", entry.config.optimization);
    row("Transformations", enabled.length ? enabled.join(", ") : "none");
    row(
      "Basic block splitting",
      entry.config.split_level === 0 ? "Off" : String(entry.config.split_level),
    );
    row("Variant id", entry.id);
    row("Experiment id", entry.source_variant_id);
    row("Dataset file", `web_data/${entry.file}`);
    row("Schema version", String(variant?.schema_version ?? dataset.index.schema_version));
    row("Compiler command line", "not recorded in this dataset");
  }

  // -------------------------------------------------------------- overlay ---
  function showOverlay(kind: "loading" | "error", message = "", detail = ""): void {
    clear(overlay);
    overlay.hidden = false;
    overlay.setAttribute("data-kind", kind);
    if (kind === "loading") {
      overlay.append(span2("overlay__spinner", ""), span2("overlay__text", "loading variant…"));
      return;
    }
    const box = doc.createElement("div");
    box.className = "overlay__error";
    box.append(span2("overlay__title", "Could not load this variant"));
    box.append(span2("overlay__text", message));
    if (detail) box.append(span2("overlay__detail", detail));
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.setAttribute("data-testid", "retry");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      currentEntry = null;
      schedule();
    });
    box.append(retry);
    overlay.append(box);
  }

  function hideOverlay(): void {
    overlay.hidden = true;
    clear(overlay);
    overlay.removeAttribute("data-kind");
  }

  // ---------------------------------------------------------------- update ---
  function applyVariant(entry: IndexVariant, variant: Variant): void {
    currentVariant = variant;
    addressIndex = instructionsByAddress(variant);
    if (entry.id === baselineEntry.id) baselineVariant = variant;

    variantLabel.textContent = entry.id;
    graphCounts.textContent = `${variant.llvm_cfg.nodes.length} blocks · ${variant.llvm_cfg.edges.length} edges`;
    graphCounts.setAttribute("data-blocks", String(variant.llvm_cfg.nodes.length));
    graphCounts.setAttribute("data-edges", String(variant.llvm_cfg.edges.length));

    paintMetrics(variant);
    paintStrings(variant);
    paintTech(entry, variant);

    if (!reducedMotion()) {
      graphCanvas.classList.add("is-swapping");
      doc.defaultView?.setTimeout(() => graphCanvas.classList.remove("is-swapping"), 160);
    }
    graph.render(variant);
    selectedNode = null;
    paintInspector();
    inspector.setAttribute("data-open", "false");
    graphStatus.textContent = `${variant.llvm_cfg.nodes.length} basic blocks, ${variant.llvm_cfg.edges.length} edges.`;
  }

  function failVariant(entry: IndexVariant | null, error: unknown): void {
    currentVariant = null;
    selectedNode = null;
    paintMetrics(null);
    paintStrings(null);
    paintInspector();
    paintTech(entry, null);
    graphCounts.textContent = "unavailable";
    graphCounts.removeAttribute("data-blocks");
    graphCounts.removeAttribute("data-edges");
    const message =
      error instanceof DatasetError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    const detail = error instanceof DatasetError ? error.detail : "";
    showOverlay("error", message, detail);
    graphStatus.textContent = `Error: ${message}`;
  }

  async function update(): Promise<void> {
    if (destroyed) return;
    const config = readConfig();
    paintSwitchStates();

    let entry: IndexVariant;
    try {
      entry = dataset.lookup(config);
    } catch (error) {
      currentEntry = null;
      variantLabel.textContent = "—";
      failVariant(null, error);
      return;
    }

    if (currentEntry?.id === entry.id && currentVariant) return;
    currentEntry = entry;
    variantLabel.textContent = entry.id;

    const token = ++sequence;
    const cached = dataset.cached(entry.id);
    if (cached) {
      hideOverlay();
      applyVariant(entry, cached);
      return;
    }

    showOverlay("loading");
    try {
      const variant = await dataset.variant(entry);
      if (token !== sequence || destroyed) return;
      hideOverlay();
      applyVariant(entry, variant);
    } catch (error) {
      if (token !== sequence || destroyed) return;
      failVariant(entry, error);
    }
  }

  function schedule(): void {
    const run = update().finally(() => {
      active.delete(run);
    });
    active.add(run);
  }

  async function settled(): Promise<void> {
    while (active.size > 0) await Promise.all(active);
  }

  // ----------------------------------------------------------------- wiring ---
  const listeners: (() => void)[] = [];
  function on(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
  ): void {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  for (const input of [...switches.values(), ...splitInputs, ...optInputs]) {
    on(input, "change", schedule);
  }

  on(resetButton, "click", () => {
    writeConfig(BASELINE_CONFIG);
    schedule();
  });

  on(must(doc, '[data-graph="zoom-in"]'), "click", () => graph.zoomBy(1.3));
  on(must(doc, '[data-graph="zoom-out"]'), "click", () => graph.zoomBy(1 / 1.3));
  on(must(doc, '[data-graph="fit"]'), "click", () => graph.fit());

  on(must(inspector, '[data-testid="inspector-close"]'), "click", closeInspector);

  on(mblockSelect, "change", () => {
    if (currentVariant) paintMachineBlock(currentVariant, Number(mblockSelect.value));
  });

  // Tabs: roving tabindex, arrow keys move between them.
  function activateTab(index: number, focus = true): void {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = doc.getElementById(tab.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !active;
    });
    if (focus) tabs[index]?.focus();
  }
  tabs.forEach((tab, i) => {
    on(tab, "click", () => activateTab(i, false));
    on(tab, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== "ArrowRight" && key !== "ArrowLeft") return;
      event.preventDefault();
      activateTab((i + (key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length);
    });
  });

  // Keyboard navigation of the graph itself.
  on(graphCanvas, "keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    const variant = currentVariant;
    if (!variant) return;
    const order = [...variant.llvm_cfg.nodes].sort((a, b) => a.order - b.order);
    if (order.length === 0) return;
    const at = order.findIndex((n) => n.id === selectedNode);

    const step = (delta: number): void => {
      const next = at < 0 ? (delta > 0 ? 0 : order.length - 1) : (at + delta + order.length) % order.length;
      selectBlock(order[next]!.id, { reveal: false, center: true });
    };

    switch (key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        step(1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        step(-1);
        break;
      case "Home":
        event.preventDefault();
        selectBlock(order[0]!.id, { reveal: false, center: true });
        break;
      case "End":
        event.preventDefault();
        selectBlock(order[order.length - 1]!.id, { reveal: false, center: true });
        break;
      case "Enter":
      case " ":
        if (selectedNode !== null) {
          event.preventDefault();
          selectBlock(selectedNode, { reveal: true, center: true });
        }
        break;
      case "+":
      case "=":
        event.preventDefault();
        graph.zoomBy(1.3);
        break;
      case "-":
        event.preventDefault();
        graph.zoomBy(1 / 1.3);
        break;
      case "0":
        event.preventDefault();
        graph.fit();
        break;
      case "Escape":
        closeInspector();
        break;
      default:
        break;
    }
  });

  on(doc, "keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    if (inspector.getAttribute("data-open") === "true" && isSheet()) closeInspector();
  });

  // source.c dialog
  let sourceLoaded = false;
  on(must(doc, '[data-testid="open-source"]'), "click", () => {
    if (!sourceLoaded) {
      sourceLoaded = true;
      dataset
        .source()
        .then((text) => {
          clear(sourceCode);
          sourceCode.append(highlightC(text));
        })
        .catch((error: unknown) => {
          sourceLoaded = false;
          sourceCode.textContent = `Could not load ${dataset.index.source_file}: ${
            error instanceof Error ? error.message : String(error)
          }`;
        });
    }
    if (typeof sourceDialog.showModal === "function") sourceDialog.showModal();
    else sourceDialog.setAttribute("open", "");
  });
  on(must(doc, '[data-testid="source-close"]'), "click", () => sourceDialog.close());

  // Viewport changes must not disturb the selected configuration.
  const view = doc.defaultView;
  if (view && typeof view.ResizeObserver === "function") {
    const observer = new view.ResizeObserver(() => graph.resize());
    observer.observe(graphCanvas);
    listeners.push(() => observer.disconnect());
  } else if (view) {
    on(view, "resize", () => graph.resize());
  }

  // ------------------------------------------------------------------ boot ---
  writeConfig(BASELINE_CONFIG);
  paintTech(baselineEntry, null);
  schedule();
  await settled();

  return {
    config: readConfig,
    variant: () => currentVariant,
    ready: settled,
    selectBlock: (nodeId) => selectBlock(nodeId, { reveal: true, center: true }),
    selectedBlock: () => selectedNode,
    destroy() {
      destroyed = true;
      for (const off of listeners) off();
      graph.destroy();
    },
  };
}
