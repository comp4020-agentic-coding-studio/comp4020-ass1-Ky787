// The page controller: reads the controls, resolves them to a dataset variant,
// loads exactly that variant, and paints the metrics, strings, graph and
// inspector from it.
//
// The graph view is injected rather than imported so the whole controller can
// be driven in a DOM without a canvas.

import { OVERVIEW, annotate } from "./annotations.js";
import { instructionsByAddress, renderInstruction } from "./asm.js";
import { buildCommand, commandText } from "./command.js";
import {
  Dataset,
  INITIAL_CONFIG,
  DatasetError,
  OPTIMIZATION_LEVELS,
  SPLIT_LEVELS,
} from "./dataset.js";
import { highlightC, highlightIr } from "./highlight.js";
import { mountHints } from "./hints.js";
import type { GraphModel, GraphView, GraphViewOptions } from "./graph.js";
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

/** Fixed experiment parameters for this dataset. */
const EXPERIMENT = {
  toolchain: "Hikari LLVM 15 — ChandHsu/Hikari-LLVM15",
  seed: "12345",
} as const;

const TRANSFORMS: { key: BooleanTransform; label: string }[] = [
  { key: "bcf", label: "Bogus Control Flow" },
  { key: "flattening", label: "Control Flow Flattening" },
  { key: "substitution", label: "Instruction Substitution" },
  { key: "string_encryption", label: "String Encryption" },
];

type GraphMode = "x86" | "ir";

/**
 * The two CFGs the dataset carries. The x86 view draws the machine CFG, whose
 * blocks really do hold machine instructions — rather than putting x86 on an
 * LLVM block, which the dataset gives no basis for.
 */
const VIEWS: Record<
  GraphMode,
  { title: string; kinds: string[]; unit: string }
> = {
  x86: {
    title: "Machine control-flow graph — x86-64",
    kinds: ["branch", "fallthrough", "jump"],
    unit: "x86 instructions",
  },
  ir: {
    title: "LLVM control-flow graph — IR",
    kinds: ["true", "false", "branch", "case", "default"],
    unit: "IR instructions",
  },
};

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
  const sourceCode = must(doc, '[data-testid="source"] code');
  const sourceNote = must(doc, '[data-testid="source-note"]');
  const asmFull = must(doc, "[data-role='asm-full']");
  const asmFullNote = must(doc, '[data-testid="asm-full-note"]');
  const cliCode = must(doc, "[data-role='cli']");
  const datasetNote = must(doc, '[data-testid="dataset-note"]');
  const asmRole = must(doc, '[data-testid="asm-role"]');
  const dock = must<HTMLElement>(doc, '[data-testid="dock"]');
  const graphTitle = must(doc, '[data-testid="graph-title"]');
  const legendList = must(doc, '[data-testid="legend"]');
  const viewInputs = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[name="view"]'),
  );
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
  let mode: GraphMode = "x86";
  let currentModel: GraphModel | null = null;
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

  // -------------------------------------------------- command and diptych ---
  function paintCommand(config: VariantConfig): void {
    clear(cliCode);
    const parts = buildCommand(config);
    const base = parts
      .filter((part) => !part.obfuscating)
      .map((part) => part.text)
      .join(" ");
    const flags = parts.filter((part) => part.obfuscating);

    cliCode.append(span2("cli-base", base));
    for (const flag of flags) {
      cliCode.append(" ", span2("cli-flag", flag.text));
    }
    if (flags.length === 0) {
      cliCode.append("  ", span2("cli-comment", "# no obfuscation passes enabled"));
    }
  }

  function paintFullAssembly(variant: Variant | null): void {
    clear(asmFull);
    if (!variant) {
      asmFullNote.textContent = "unavailable";
      return;
    }
    const instructions = variant.disassembly.instructions;
    const fragment = doc.createDocumentFragment();
    instructions.forEach((instruction, i) => {
      fragment.append(renderInstruction(instruction));
      if (i < instructions.length - 1) fragment.append("\n");
    });
    asmFull.append(fragment);
    asmFullNote.textContent = `${variant.metrics.instruction_count.toLocaleString(
      "en-AU",
    )} instructions · ${variant.metrics.main_byte_size.toLocaleString("en-AU")} bytes`;

    const on = TRANSFORMS.filter(({ key }) => variant.config[key]).length;
    const split = variant.config.split_level !== 0;
    asmRole.textContent =
      on === 0 && !split
        ? "What the CPU executes — without obfuscation"
        : `What the CPU executes — with ${on + (split ? 1 : 0)} transformation${
            on + (split ? 1 : 0) === 1 ? "" : "s"
          } on`;
  }

  async function loadSource(): Promise<void> {
    try {
      const text = await dataset.source();
      // The code is rendered verbatim, line by line. The plain-English notes
      // are this page's, in their own span and their own colour — the compiled
      // file has no comments in it.
      const { lines, unmatched } = annotate(text);
      clear(sourceCode);
      for (const line of OVERVIEW) {
        sourceCode.append(span2("c-note", `// ${line}`), "\n");
      }
      sourceCode.append("\n");
      lines.forEach(({ code, note }, i) => {
        const row = doc.createElement("span");
        row.className = "c-line";
        const codeSpan = doc.createElement("span");
        codeSpan.className = "c-code";
        codeSpan.append(highlightC(code));
        row.append(codeSpan);
        if (note) row.append(span2("c-note", `${code.trim() ? "  " : ""}// ${note}`));
        sourceCode.append(row);
        if (i < lines.length - 1) sourceCode.append("\n");
      });
      sourceNote.textContent =
        `${lines.length} lines · identical for all ${dataset.index.variant_count} variants` +
        ` · notes in grey are added by this page`;
      if (unmatched.length > 0) {
        sourceNote.textContent += ` · ${unmatched.length} note(s) no longer match the source`;
      }
    } catch (error) {
      sourceCode.textContent = `Could not load ${dataset.index.source_file}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      sourceNote.textContent = "unavailable";
    }
  }

  // ----------------------------------------------------------------- graph ---
  function trimLine(text: string): string {
    return text.trim();
  }

  /** The machine CFG: real x86, straight out of the disassembly. */
  function machineModel(variant: Variant): GraphModel {
    return {
      entryId: variant.machine_cfg.entry_node_id,
      nodes: variant.machine_cfg.nodes.map((node) => ({
        id: node.id,
        label: hex(node.start),
        total: node.instruction_addresses.length,
        lines: node.instruction_addresses
          .slice(0, 6)
          .map((address) => {
            const instruction = addressIndex.get(address);
            if (!instruction) return "";
            return trimLine(`${instruction.mnemonic} ${instruction.op_str}`);
          })
          .filter(Boolean),
      })),
      edges: variant.machine_cfg.edges.map((edge) => ({ ...edge })),
    };
  }

  /** The LLVM CFG, with the IR each block carries. */
  function llvmModel(variant: Variant): GraphModel {
    return {
      entryId: variant.llvm_cfg.entry_node_id,
      nodes: variant.llvm_cfg.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        total: node.instructions.length,
        lines: node.instructions.slice(0, 6).map(trimLine),
      })),
      edges: variant.llvm_cfg.edges.map((edge) => ({ ...edge })),
    };
  }

  function modelFor(variant: Variant): GraphModel {
    return mode === "x86" ? machineModel(variant) : llvmModel(variant);
  }

  function paintLegend(): void {
    clear(legendList);
    const item = (
      className: string,
      kind: string | null,
      text: string,
    ): void => {
      const li = doc.createElement("li");
      li.className = "legend__item";
      if (kind) li.setAttribute("data-kind", kind);
      const swatch = doc.createElement("span");
      swatch.className = className;
      swatch.setAttribute("aria-hidden", "true");
      li.append(swatch, span2("", text));
      legendList.append(li);
    };
    item("legend__node", null, "block label, instruction count, first lines");
    item("legend__node legend__node--entry", null, "entry block");
    for (const kind of VIEWS[mode].kinds) item("legend__edge", kind, kind);
  }

  function paintGraph(variant: Variant): void {
    graphTitle.textContent = VIEWS[mode].title;
    const model = modelFor(variant);
    currentModel = model;
    graphCounts.textContent = `${model.nodes.length} blocks · ${model.edges.length} edges`;
    graphCounts.setAttribute("data-blocks", String(model.nodes.length));
    graphCounts.setAttribute("data-edges", String(model.edges.length));
    paintLegend();
    graph.render(model);
  }

  // ------------------------------------------------------------- inspector ---
  function edgeChips(
    model: GraphModel,
    nodeId: number,
    outgoing: boolean,
  ): HTMLElement {
    const dd = doc.createElement("dd");
    const labels = new Map(model.nodes.map((n) => [n.id, n.label]));
    const matches = model.edges.filter((edge) =>
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
    const model = currentModel;
    if (!variant || !model || selectedNode === null) {
      clearInspector();
      return;
    }
    const block = model.nodes.find((n) => n.id === selectedNode);
    if (!block) {
      clearInspector();
      return;
    }

    inspector.setAttribute("data-selected", "true");
    inspector.setAttribute("data-mode", mode);
    inspectorEmpty.hidden = true;
    inspectorBody.hidden = false;
    blockLabel.textContent = block.label;
    blockEntry.hidden = block.id !== model.entryId;

    clear(inspectorMeta);
    metaRow(VIEWS[mode].unit, String(block.total));

    if (mode === "x86") {
      const machine = variant.machine_cfg.nodes.find((n) => n.id === block.id);
      if (machine) {
        metaRow("Address range", `${hex(machine.start)}–${hex(machine.end)}`);
      }
      metaRow("Predecessors", edgeChips(model, block.id, false));
      metaRow("Successors", edgeChips(model, block.id, true));
      // The block on screen *is* a machine block, so there is nothing to
      // reconcile and nothing to disclaim.
      paintMachineBlock(variant, block.id);
      activateTab(1, false);
      return;
    }

    const node = variant.llvm_cfg.nodes.find((n) => n.id === block.id);
    if (!node) {
      clearInspector();
      return;
    }
    metaRow("Layout order", String(node.order));
    metaRow("Predecessors", edgeChips(model, block.id, false));
    metaRow("Successors", edgeChips(model, block.id, true));
    paintIr(node);
    paintMachineTab(variant, node.id);
    activateTab(0, false);
  }

  function selectBlock(
    nodeId: number | null,
    options: { reveal: boolean; center: boolean },
  ): void {
    selectedNode = nodeId;
    graph.select(nodeId, { center: options.center });
    paintInspector();
    if (nodeId !== null && currentModel) {
      const block = currentModel.nodes.find((n) => n.id === nodeId);
      const out = currentModel.edges.filter((e) => e.source === nodeId).length;
      graphStatus.textContent = block
        ? `Block ${block.label}, ${block.total} ${VIEWS[mode].unit}, ${out} outgoing edge${out === 1 ? "" : "s"}.`
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

    paintMetrics(variant);
    paintStrings(variant);
    paintFullAssembly(variant);
    paintTech(entry, variant);

    if (!reducedMotion()) {
      graphCanvas.classList.add("is-swapping");
      doc.defaultView?.setTimeout(() => graphCanvas.classList.remove("is-swapping"), 160);
    }
    paintGraph(variant);
    selectedNode = null;
    paintInspector();
    inspector.setAttribute("data-open", "false");
    graphStatus.textContent = graphCounts.textContent ?? "";
  }

  function failVariant(entry: IndexVariant | null, error: unknown): void {
    currentVariant = null;
    selectedNode = null;
    paintMetrics(null);
    paintStrings(null);
    paintFullAssembly(null);
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
    // The command follows the controls, not the fetch: it is true of the
    // configuration whether or not the variant loads.
    paintCommand(config);

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
    writeConfig(INITIAL_CONFIG);
    schedule();
  });

  for (const input of viewInputs) {
    on(input, "change", () => {
      if (!input.checked) return;
      mode = input.value === "ir" ? "ir" : "x86";
      const variant = currentVariant;
      if (!variant) return;
      selectedNode = null;
      paintGraph(variant);
      paintInspector();
      inspector.setAttribute("data-open", "false");
    });
  }

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
    const order = currentModel?.nodes ?? [];
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

  const copyButton = must<HTMLButtonElement>(doc, '[data-testid="cli-copy"]');
  on(copyButton, "click", () => {
    const text = commandText(readConfig());
    const clipboard = doc.defaultView?.navigator?.clipboard;
    const done = (label: string): void => {
      copyButton.textContent = label;
      doc.defaultView?.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    };
    if (!clipboard) {
      done("Ctrl+C");
      return;
    }
    clipboard.writeText(text).then(
      () => done("Copied"),
      () => done("Ctrl+C"),
    );
  });

  // Viewport changes must not disturb the selected configuration.
  const view = doc.defaultView;
  if (view && typeof view.ResizeObserver === "function") {
    const observer = new view.ResizeObserver(() => graph.resize());
    observer.observe(graphCanvas);
    listeners.push(() => observer.disconnect());

    // The graph section sizes itself against the sticky controls, so their
    // height has to be a number the stylesheet can read.
    const dockObserver = new view.ResizeObserver(() => {
      doc.documentElement.style.setProperty(
        "--dock-h",
        `${Math.round(dock.getBoundingClientRect().height)}px`,
      );
    });
    dockObserver.observe(dock);
    listeners.push(() => dockObserver.disconnect());
  } else if (view) {
    on(view, "resize", () => graph.resize());
  }

  // ------------------------------------------------------------------ boot ---
  listeners.push(mountHints(doc));

  writeConfig(INITIAL_CONFIG);
  paintTech(baselineEntry, null);
  datasetNote.textContent = `${dataset.index.variant_count} pre-built Windows x86 binaries`;
  schedule();

  // The page no longer opens on the comparison baseline, so fetch it too:
  // without it the watched-strings row has no left-hand number to show.
  const baselineWarmup = dataset
    .variant(baselineEntry)
    .then((variant) => {
      baselineVariant ??= variant;
      if (currentVariant) paintMetrics(currentVariant);
    })
    .catch(() => {
      /* the metrics fall back to "—"; the selected variant still renders */
    });

  await Promise.all([settled(), loadSource(), baselineWarmup]);

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
