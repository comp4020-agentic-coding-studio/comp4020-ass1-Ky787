// @vitest-environment jsdom
//
// Contract: what the page does when a person uses it. The controller is mounted
// against the real built markup and the real dataset, with only the graph view
// stubbed, so a broken data mapping or a missing hook fails here.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASELINE_CONFIG } from "../src/dataset.js";
import type { Variant } from "../src/types.js";
import {
  click,
  el,
  makeLoader,
  metricCell,
  mountApp,
  numberIn,
  press,
  setControls,
  type Mounted,
} from "./harness.js";

const CLEAN = "o0-bcf0-fla0-sub0-str0-split0";

function fileOf(id: string): string {
  return `variants/${id}.json`;
}

function onDisk(id: string): Variant {
  return JSON.parse(
    readFileSync(join(resolve("web_data"), fileOf(id)), "utf8"),
  ) as Variant;
}

let mounted: Mounted;

afterEach(() => {
  mounted?.app.destroy();
});

describe("first load", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("starts at the clean O0 variant with everything off", () => {
    expect(mounted.app.config()).toEqual(BASELINE_CONFIG);
    expect(mounted.app.variant()?.id).toBe(CLEAN);
    expect(el("variant-id").textContent).toBe(CLEAN);
  });

  it("fetches the index and exactly one variant", () => {
    expect(mounted.control.requests).toEqual(["index.json", fileOf(CLEAN)]);
  });

  it("renders that variant's graph, fitted", () => {
    expect(mounted.graph.rendered).toHaveLength(1);
    expect(mounted.graph.lastRendered()?.id).toBe(CLEAN);
  });

  it("shows no block inspector until a block is picked", () => {
    expect(el("inspector").getAttribute("data-open")).toBe("false");
    expect(
      el("inspector").querySelector<HTMLElement>("[data-role='body']")?.hidden,
    ).toBe(true);
  });
});

describe("the controls select the variant", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("loads the BCF variant when Bogus Control Flow is switched on", async () => {
    await setControls(mounted.app, { bcf: true });
    expect(mounted.app.variant()?.id).toBe("o0-bcf1-fla0-sub0-str0-split0");
    expect(mounted.control.requests).toContain(
      fileOf("o0-bcf1-fla0-sub0-str0-split0"),
    );
  });

  const singles = [
    ["bcf", "o0-bcf1-fla0-sub0-str0-split0"],
    ["flattening", "o0-bcf0-fla1-sub0-str0-split0"],
    ["substitution", "o0-bcf0-fla0-sub1-str0-split0"],
    ["string_encryption", "o0-bcf0-fla0-sub0-str1-split0"],
  ] as const;

  for (const [key, id] of singles) {
    it(`switching ${key} on loads ${id}`, async () => {
      await setControls(mounted.app, { [key]: true });
      expect(mounted.app.variant()?.id).toBe(id);
      expect(mounted.app.config()[key]).toBe(true);
    });
  }

  for (const level of [0, 2, 3, 4] as const) {
    it(`split ${level === 0 ? "Off" : level} loads split${level}`, async () => {
      await setControls(mounted.app, { split_level: level });
      expect(mounted.app.variant()?.id).toBe(
        `o0-bcf0-fla0-sub0-str0-split${level}`,
      );
    });
  }

  for (const level of ["O0", "O1", "O2", "O3"] as const) {
    it(`${level} loads the ${level.toLowerCase()} variant`, async () => {
      await setControls(mounted.app, { optimization: level });
      expect(mounted.app.variant()?.id).toBe(
        `${level.toLowerCase()}-bcf0-fla0-sub0-str0-split0`,
      );
    });
  }

  it("maps a full combination to the one matching variant", async () => {
    await setControls(mounted.app, {
      optimization: "O2",
      bcf: true,
      substitution: true,
      split_level: 3,
    });
    expect(mounted.app.variant()?.id).toBe("o2-bcf1-fla0-sub1-str0-split3");

    await setControls(mounted.app, {
      optimization: "O3",
      flattening: true,
      string_encryption: true,
      split_level: 4,
    });
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla1-sub1-str1-split4");
  });

  it("shows the switch state in text as well as colour", async () => {
    const row = el("toggle-bcf").closest(".switch");
    expect(row?.querySelector(".switch__state")?.textContent).toBe("OFF");
    await setControls(mounted.app, { bcf: true });
    expect(row?.querySelector(".switch__state")?.textContent).toBe("ON");
    expect(row?.getAttribute("data-on")).toBe("true");
  });

  it("re-serves a cached variant without fetching it again", async () => {
    await setControls(mounted.app, { bcf: true });
    const before = mounted.control.requests.length;
    await setControls(mounted.app, { bcf: false });
    await setControls(mounted.app, { bcf: true });
    expect(mounted.control.requests).toHaveLength(before);
    expect(mounted.app.variant()?.id).toBe("o0-bcf1-fla0-sub0-str0-split0");
  });

  it("ignores a slow response that has been overtaken", async () => {
    const slow = fileOf("o0-bcf1-fla0-sub0-str0-split0");
    mounted.control.delays.set(slow, 80);

    const bcf = el<HTMLInputElement>("toggle-bcf");
    bcf.checked = true;
    bcf.dispatchEvent(new window.Event("change", { bubbles: true }));

    const o1 = document.querySelector<HTMLInputElement>(
      'input[name="opt"][value="O1"]',
    )!;
    o1.checked = true;
    o1.dispatchEvent(new window.Event("change", { bubbles: true }));

    await mounted.app.ready();
    expect(mounted.app.variant()?.id).toBe("o1-bcf1-fla0-sub0-str0-split0");

    await new Promise((done) => setTimeout(done, 140));
    expect(mounted.graph.lastRendered()?.id).toBe(
      "o1-bcf1-fla0-sub0-str0-split0",
    );
    expect(mounted.app.variant()?.id).toBe("o1-bcf1-fla0-sub0-str0-split0");
  });

  it("does not rebuild the page when the variant changes", async () => {
    const stage = el("graph");
    const metrics = el("metrics");
    const before = mounted.graph.rendered.length;
    await setControls(mounted.app, { flattening: true });
    expect(el("graph")).toBe(stage);
    expect(el("metrics")).toBe(metrics);
    expect(mounted.graph.rendered.length).toBe(before + 1);
  });
});

describe("Reset", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("returns every control and the loaded variant to clean O0", async () => {
    await setControls(mounted.app, {
      optimization: "O3",
      bcf: true,
      flattening: true,
      substitution: true,
      string_encryption: true,
      split_level: 4,
    });
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla1-sub1-str1-split4");

    click(el("reset"));
    await mounted.app.ready();

    expect(mounted.app.config()).toEqual(BASELINE_CONFIG);
    expect(mounted.app.variant()?.id).toBe(CLEAN);
    for (const input of document.querySelectorAll<HTMLInputElement>(
      "[data-transform]",
    )) {
      expect(input.checked).toBe(false);
    }
    expect(
      document.querySelector<HTMLInputElement>('input[name="split"][value="0"]')
        ?.checked,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>('input[name="opt"][value="O0"]')
        ?.checked,
    ).toBe(true);
  });
});

describe("the complexity summary reads from the loaded JSON", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  const cells = [
    ["instructions", "instruction_count"],
    ["blocks", "llvm_basic_block_count"],
    ["edges", "llvm_cfg_edge_count"],
    ["bytes", "main_byte_size"],
  ] as const;

  it("keeps the clean baseline on the left for every metric", async () => {
    const clean = onDisk(CLEAN);
    await setControls(mounted.app, { optimization: "O3", bcf: true });
    for (const [cell, key] of cells) {
      expect(numberIn(metricCell(cell), "base"), cell).toBe(clean.metrics[key]);
    }
  });

  it("shows the selected variant's own numbers on the right", async () => {
    for (const id of [
      CLEAN,
      "o0-bcf1-fla0-sub0-str0-split0",
      "o3-bcf1-fla1-sub1-str1-split4",
    ]) {
      const expected = onDisk(id);
      await setControls(mounted.app, expected.config);
      expect(mounted.app.variant()?.id).toBe(id);
      for (const [cell, key] of cells) {
        expect(numberIn(metricCell(cell), "current"), `${id}.${cell}`).toBe(
          expected.metrics[key],
        );
      }
    }
  });

  it("counts watched plaintext strings from the variant, not a constant", async () => {
    expect(numberIn(metricCell("strings"), "current")).toBe(3);
    await setControls(mounted.app, { string_encryption: true });
    expect(numberIn(metricCell("strings"), "current")).toBe(0);
    expect(numberIn(metricCell("strings"), "base")).toBe(3);
  });

  it("marks the direction of change without relying on colour", async () => {
    await setControls(mounted.app, { bcf: true });
    expect(metricCell("instructions").getAttribute("data-direction")).toBe("up");
    expect(
      metricCell("instructions").querySelector("[data-role='delta']")
        ?.textContent,
    ).toMatch(/▲/);
    expect(
      metricCell("instructions").querySelector("[data-role='sr']")?.textContent,
    ).toMatch(/baseline/);
  });
});

describe("the graph gets exactly the dataset's blocks and edges", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("hands the view the variant's own CFG", async () => {
    for (const id of [CLEAN, "o1-bcf1-fla1-sub0-str1-split4"]) {
      const expected = onDisk(id);
      await setControls(mounted.app, expected.config);
      const rendered = mounted.graph.lastRendered();
      expect(rendered?.id).toBe(id);
      expect(rendered?.llvm_cfg.nodes).toEqual(expected.llvm_cfg.nodes);
      expect(rendered?.llvm_cfg.edges).toEqual(expected.llvm_cfg.edges);
    }
  });

  it("reports the same counts in the heading as the data holds", async () => {
    const expected = onDisk("o0-bcf0-fla1-sub0-str0-split0");
    await setControls(mounted.app, { flattening: true });
    const counts = el("graph-counts");
    expect(counts.getAttribute("data-blocks")).toBe(
      String(expected.llvm_cfg.nodes.length),
    );
    expect(counts.getAttribute("data-edges")).toBe(
      String(expected.llvm_cfg.edges.length),
    );
    expect(counts.textContent).toContain(
      `${expected.metrics.llvm_basic_block_count} blocks`,
    );
  });

  it("drives zoom and fit from the toolbar", () => {
    click(document.querySelector('[data-graph="zoom-in"]')!);
    click(document.querySelector('[data-graph="zoom-out"]')!);
    click(el("fit"));
    expect(mounted.graph.zoomFactors).toHaveLength(2);
    expect(mounted.graph.zoomFactors[0]).toBeGreaterThan(1);
    expect(mounted.graph.zoomFactors[1]).toBeLessThan(1);
    expect(mounted.graph.fits).toBe(1);
  });
});

describe("the block inspector shows the block's own text", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("prints the LLVM IR verbatim", () => {
    const clean = onDisk(CLEAN);
    mounted.graph.clickNode(1);
    const node = clean.llvm_cfg.nodes.find((n) => n.id === 1)!;
    expect(el("ir").textContent).toBe(node.instructions.join("\n"));
    expect(mounted.app.selectedBlock()).toBe(1);
  });

  it("labels the entry block and lists real successors", () => {
    const clean = onDisk(CLEAN);
    mounted.graph.clickNode(clean.llvm_cfg.entry_node_id);
    expect(
      document.querySelector<HTMLElement>("[data-role='block-entry']")?.hidden,
    ).toBe(false);
    const successors = [
      ...el("inspector-meta").querySelectorAll(".edge-chip"),
    ].map((chip) => chip.textContent);
    for (const edge of clean.llvm_cfg.edges.filter(
      (e) => e.source === clean.llvm_cfg.entry_node_id,
    )) {
      const label = clean.llvm_cfg.nodes.find((n) => n.id === edge.target)!.label;
      expect(successors).toContain(`→ ${label} · ${edge.kind}`);
    }
  });

  it("prints machine instructions exactly as Capstone gave them", () => {
    const clean = onDisk(CLEAN);
    mounted.graph.clickNode(0);
    click(el("tab-asm"));

    const block = clean.machine_cfg.nodes.find((n) => n.id === 0)!;
    const byAddress = new Map(
      clean.disassembly.instructions.map((i) => [i.address, i]),
    );
    const lines = [...el("asm").querySelectorAll(".asm-line")];
    expect(lines).toHaveLength(block.instruction_addresses.length);

    block.instruction_addresses.forEach((address, i) => {
      const instruction = byAddress.get(address)!;
      const reloc =
        instruction.relocations.length > 0
          ? `; ${instruction.relocations.map((r) => r.symbol).join(", ")}`
          : "";
      expect(lines[i]!.textContent).toBe(
        `${instruction.address_hex}${instruction.mnemonic}${instruction.op_str}${reloc}`,
      );
    });
  });

  it("says plainly that no LLVM-to-machine mapping is recorded", () => {
    mounted.graph.clickNode(0);
    expect(el("asm-provenance").textContent).toMatch(/no explicit .*mapping/i);
  });

  it("lets a different machine block be read when the CFGs differ", async () => {
    await setControls(mounted.app, { optimization: "O3", flattening: true });
    const variant = mounted.app.variant()!;
    mounted.graph.clickNode(variant.llvm_cfg.entry_node_id);
    const select = el<HTMLSelectElement>("mblock");
    expect(select.options).toHaveLength(variant.machine_cfg.nodes.length);
    expect(el("asm-provenance").textContent).toContain(
      `${variant.machine_cfg.nodes.length} blocks`,
    );
  });

  it("clears itself when the variant changes", async () => {
    mounted.graph.clickNode(1);
    expect(mounted.app.selectedBlock()).toBe(1);
    await setControls(mounted.app, { bcf: true });
    expect(mounted.app.selectedBlock()).toBeNull();
    expect(
      el("inspector").querySelector<HTMLElement>("[data-role='body']")?.hidden,
    ).toBe(true);
  });

  it("closes back to the empty state", () => {
    mounted.graph.clickNode(1);
    click(el("inspector-close"));
    expect(mounted.app.selectedBlock()).toBeNull();
    expect(el("inspector").getAttribute("data-open")).toBe("false");
  });
});

describe("keyboard", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("gives every control a real focusable input with a label", () => {
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>(
        "[data-transform], input[name='split'], input[name='opt']",
      ),
    ];
    expect(inputs).toHaveLength(12);
    for (const input of inputs) {
      expect(input.disabled).toBe(false);
      expect(input.tabIndex).toBeGreaterThanOrEqual(0);
      expect(input.closest("label")?.textContent?.trim()).not.toBe("");
    }
    for (const button of document.querySelectorAll("button")) {
      const name =
        button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
      expect(name.length, button.outerHTML).toBeGreaterThan(0);
    }
  });

  it("steps between blocks with the arrow keys", () => {
    const clean = onDisk(CLEAN);
    const graph = el<HTMLElement>("graph");
    expect(graph.tabIndex).toBe(0);

    press(graph, "ArrowDown");
    expect(mounted.app.selectedBlock()).toBe(clean.llvm_cfg.nodes[0]!.id);
    press(graph, "ArrowDown");
    expect(mounted.app.selectedBlock()).toBe(clean.llvm_cfg.nodes[1]!.id);
    press(graph, "ArrowUp");
    expect(mounted.app.selectedBlock()).toBe(clean.llvm_cfg.nodes[0]!.id);
    press(graph, "End");
    expect(mounted.app.selectedBlock()).toBe(clean.llvm_cfg.nodes.at(-1)!.id);
    expect(el("graph-status").textContent).toMatch(/IR instructions/);
  });

  it("zooms and fits from the graph", () => {
    const graph = el("graph");
    press(graph, "+");
    press(graph, "-");
    press(graph, "0");
    expect(mounted.graph.zoomFactors).toHaveLength(2);
    expect(mounted.graph.fits).toBe(1);
  });

  it("moves between the inspector tabs with arrow keys", () => {
    mounted.graph.clickNode(0);
    press(el("tab-ir"), "ArrowRight");
    expect(el("tab-asm").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("panel-ir")?.hidden).toBe(true);
    press(el("tab-asm"), "ArrowLeft");
    expect(el("tab-ir").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("panel-asm")?.hidden).toBe(true);
  });
});

describe("watched strings", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("lists the dataset's own strings and their state", async () => {
    const rows = () => [...el("strings").querySelectorAll<HTMLElement>(".string")];
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.dataset.present === "true")).toBe(true);
    expect(rows()[0]?.textContent).toContain("ACCESS GRANTED");
    expect(el("strings-note").textContent).toMatch(/All 3 watched literals/);

    await setControls(mounted.app, { string_encryption: true });
    expect(rows().every((r) => r.dataset.present === "false")).toBe(true);
    expect(el("strings-note").textContent).toMatch(/String Encryption is on/);
  });

  it("never calls a string encrypted while it is still in the object", () => {
    for (const row of el("strings").querySelectorAll(".string")) {
      expect(row.textContent).not.toMatch(/encrypt/i);
      expect(row.querySelector(".string__state")?.textContent).toBe("PLAINTEXT");
    }
  });
});

describe("failures stay visible instead of breaking the page", () => {
  it("shows an error with a retry when a variant cannot be fetched", async () => {
    const control = makeLoader();
    mounted = await mountApp(control);
    const target = fileOf("o0-bcf1-fla0-sub0-str0-split0");
    control.failures.add(target);

    await setControls(mounted.app, { bcf: true });

    const overlay = document.querySelector<HTMLElement>("[data-role='overlay']")!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.getAttribute("data-kind")).toBe("error");
    expect(overlay.textContent).toContain("Could not load");
    expect(el("graph-counts").textContent).toBe("unavailable");
    expect(numberIn(metricCell("instructions"), "current")).toBeNull();
    expect(mounted.app.variant()).toBeNull();
    expect(el("toggle-bcf").hasAttribute("disabled")).toBe(false);

    control.failures.delete(target);
    click(el("retry"));
    await mounted.app.ready();

    expect(overlay.hidden).toBe(true);
    expect(mounted.app.variant()?.id).toBe("o0-bcf1-fla0-sub0-str0-split0");
    expect(numberIn(metricCell("instructions"), "current")).toBe(
      onDisk("o0-bcf1-fla0-sub0-str0-split0").metrics.instruction_count,
    );
  });

  it("survives a failed first load and recovers when a control changes", async () => {
    const control = makeLoader();
    control.failures.add(fileOf(CLEAN));
    mounted = await mountApp(control);
    expect(mounted.app.variant()).toBeNull();
    expect(
      document.querySelector<HTMLElement>("[data-role='overlay']")?.hidden,
    ).toBe(false);

    await setControls(mounted.app, { bcf: true });
    expect(mounted.app.variant()?.id).toBe("o0-bcf1-fla0-sub0-str0-split0");
  });
});

describe("viewport changes", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("keeps the selected configuration when the window resizes", async () => {
    await setControls(mounted.app, {
      optimization: "O2",
      bcf: true,
      split_level: 3,
    });
    const before = mounted.app.variant()?.id;
    const renders = mounted.graph.rendered.length;

    window.dispatchEvent(new window.Event("resize"));
    window.dispatchEvent(new window.Event("resize"));

    expect(mounted.app.config()).toEqual({
      optimization: "O2",
      bcf: true,
      flattening: false,
      substitution: false,
      string_encryption: false,
      split_level: 3,
    });
    expect(mounted.app.variant()?.id).toBe(before);
    expect(mounted.graph.rendered).toHaveLength(renders);
    expect(mounted.graph.resizes).toBeGreaterThan(0);
  });
});

describe("technical details", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("describes the selected configuration in compiler terms", async () => {
    await setControls(mounted.app, {
      optimization: "O2",
      bcf: true,
      substitution: true,
      split_level: 3,
    });
    const text = el("tech").textContent ?? "";
    expect(text).toContain("Hikari LLVM 15");
    expect(text).toContain("12345");
    expect(text).toContain("O2");
    expect(text).toContain("Bogus Control Flow, Instruction Substitution");
    expect(text).toContain("o2-bcf1-fla0-sub1-str0-split3");
    expect(text).toContain("web_data/variants/o2-bcf1-fla0-sub1-str0-split3.json");
    expect(text).toMatch(/not recorded in this dataset/);
  });

  it("shows source.c on demand, unchanged", async () => {
    click(el("open-source"));
    await new Promise((done) => setTimeout(done, 0));
    const shown = el("source").textContent;
    expect(shown).toBe(readFileSync(resolve("web_data/source.c"), "utf8"));
    expect(mounted.control.requests).toContain("source.c");
  });
});
