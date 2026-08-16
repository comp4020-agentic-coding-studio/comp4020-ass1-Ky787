// @vitest-environment jsdom
//
// Contract: what the page does when a person uses it. The controller is mounted
// against the real built markup and the real dataset, with only the graph view
// stubbed, so a broken data mapping or a missing hook fails here.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASELINE_CONFIG, INITIAL_CONFIG } from "../src/dataset.js";
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
  setView,
  type Mounted,
} from "./harness.js";

const BASELINE = "o0-bcf0-fla0-sub0-str0-split0";
const CLEAN = "o3-bcf0-fla0-sub0-str0-split0";

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

  it("starts clean at O3, with every transformation off", () => {
    expect(mounted.app.config()).toEqual(INITIAL_CONFIG);
    expect(mounted.app.config().optimization).toBe("O3");
    expect(mounted.app.variant()?.id).toBe(CLEAN);
    expect(el("variant-id").textContent).toBe(CLEAN);
  });

  it("has the two ids this file names still meaning what it thinks", () => {
    // BASELINE and CLEAN are written out above so the assertions read plainly;
    // this keeps them honest if either config constant is ever changed.
    expect(mounted.dataset.lookup(BASELINE_CONFIG).id).toBe(BASELINE);
    expect(mounted.dataset.lookup(INITIAL_CONFIG).id).toBe(CLEAN);
  });

  it("fetches the index, the source, the shown variant and the baseline", () => {
    expect([...mounted.control.requests].sort()).toEqual(
      ["index.json", "source.c", fileOf(CLEAN), fileOf(BASELINE)].sort(),
    );
    // The baseline is the left-hand number in every metric; without it the
    // plaintext-strings row would have nothing to compare against.
    expect(
      mounted.control.requests.filter((path) => path.startsWith("variants/")),
    ).toHaveLength(2);
  });

  it("draws the machine CFG of that variant", () => {
    const model = mounted.graph.lastRendered();
    const expected = onDisk(CLEAN);
    expect(model?.nodes).toHaveLength(expected.machine_cfg.nodes.length);
    expect(model?.edges).toHaveLength(expected.machine_cfg.edges.length);
    expect(model?.entryId).toBe(expected.machine_cfg.entry_node_id);
  });

  it("picks no block until one is chosen", () => {
    expect(mounted.app.selectedBlock()).toBeNull();
  });
});

describe("the controls select the variant", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("loads the BCF variant when Bogus Control Flow is switched on", async () => {
    await setControls(mounted.app, { bcf: true });
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla0-sub0-str0-split0");
    expect(mounted.control.requests).toContain(
      fileOf("o3-bcf1-fla0-sub0-str0-split0"),
    );
  });

  const singles = [
    ["bcf", "o3-bcf1-fla0-sub0-str0-split0"],
    ["flattening", "o3-bcf0-fla1-sub0-str0-split0"],
    ["substitution", "o3-bcf0-fla0-sub1-str0-split0"],
    ["string_encryption", "o3-bcf0-fla0-sub0-str1-split0"],
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
        `o3-bcf0-fla0-sub0-str0-split${level}`,
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
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla0-sub0-str0-split0");
  });

  it("ignores a slow response that has been overtaken", async () => {
    const slow = fileOf("o3-bcf1-fla0-sub0-str0-split0");
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

    expect(mounted.app.config()).toEqual(INITIAL_CONFIG);
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
      document.querySelector<HTMLInputElement>('input[name="opt"][value="O3"]')
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

  it("keeps the clean O0 baseline on the left for every metric", async () => {
    const baseline = onDisk(BASELINE);
    await setControls(mounted.app, { optimization: "O3", flattening: true });
    for (const [cell, key] of cells) {
      expect(numberIn(metricCell(cell), "base"), cell).toBe(
        baseline.metrics[key],
      );
    }
  });

  it("shows the selected variant's own numbers on the right", async () => {
    for (const id of [
      CLEAN,
      "o0-bcf1-fla0-sub0-str0-split0",
      "o3-bcf1-fla1-sub1-str1-split4",
    ] as const) {
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
    await setControls(mounted.app, { flattening: true });
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

  it("hands the view the machine CFG, edge kinds and all", async () => {
    for (const id of [CLEAN, "o1-bcf1-fla1-sub0-str1-split4"]) {
      const expected = onDisk(id);
      await setControls(mounted.app, expected.config);
      const model = mounted.graph.lastRendered();
      expect(model?.entryId, id).toBe(expected.machine_cfg.entry_node_id);
      expect(model?.nodes.map((n) => n.id), id).toEqual(
        expected.machine_cfg.nodes.map((n) => n.id),
      );
      expect(model?.edges, id).toEqual(
        expected.machine_cfg.edges.map((e) => ({ ...e })),
      );
    }
  });

  it("hands the view the LLVM CFG when the reader asks for IR", async () => {
    const expected = onDisk("o1-bcf1-fla1-sub0-str1-split4");
    await setControls(mounted.app, expected.config);
    setView("ir");
    const model = mounted.graph.lastRendered();
    expect(model?.entryId).toBe(expected.llvm_cfg.entry_node_id);
    expect(model?.nodes.map((n) => n.id)).toEqual(
      expected.llvm_cfg.nodes.map((n) => n.id),
    );
    expect(model?.nodes.map((n) => n.label)).toEqual(
      expected.llvm_cfg.nodes.map((n) => n.label),
    );
    expect(model?.edges).toEqual(expected.llvm_cfg.edges.map((e) => ({ ...e })));
    setView("x86");
    expect(mounted.graph.lastRendered()?.nodes).toHaveLength(
      expected.machine_cfg.nodes.length,
    );
  });

  it("previews each block's own code inside it, truncated not invented", async () => {
    const expected = onDisk(CLEAN);
    const model = mounted.graph.lastRendered()!;
    const byAddress = new Map(
      expected.disassembly.instructions.map((i) => [i.address, i]),
    );
    for (const block of model.nodes) {
      const machine = expected.machine_cfg.nodes.find((n) => n.id === block.id)!;
      expect(block.total).toBe(machine.instruction_addresses.length);
      block.lines.forEach((line, i) => {
        const instruction = byAddress.get(machine.instruction_addresses[i]!)!;
        expect(line).toBe(
          `${instruction.mnemonic} ${instruction.op_str}`.trim(),
        );
      });
    }
  });

  it("reports the counts of whichever CFG is on screen", async () => {
    const expected = onDisk("o3-bcf0-fla1-sub0-str0-split0");
    await setControls(mounted.app, { flattening: true });
    const counts = el("graph-counts");
    expect(counts.getAttribute("data-blocks")).toBe(
      String(expected.metrics.machine_basic_block_count),
    );
    expect(counts.getAttribute("data-edges")).toBe(
      String(expected.metrics.machine_cfg_edge_count),
    );
    expect(el("graph-title").textContent).toMatch(/x86/i);

    setView("ir");
    expect(counts.getAttribute("data-blocks")).toBe(
      String(expected.metrics.llvm_basic_block_count),
    );
    expect(el("graph-title").textContent).toMatch(/LLVM/i);
  });

  it("labels the legend for whichever CFG is on screen", () => {
    const kinds = () =>
      [...el("legend").querySelectorAll("[data-kind]")].map((li) =>
        li.getAttribute("data-kind"),
      );
    expect(kinds()).toEqual(["branch", "fallthrough", "jump"]);
    setView("ir");
    expect(kinds()).toEqual(["true", "false", "branch", "case", "default"]);
    // Every entry names its kind in words, not just a colour.
    for (const li of el("legend").querySelectorAll(".legend__item")) {
      expect(li.textContent?.trim()).not.toBe("");
    }
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
    const nodes = onDisk(CLEAN).machine_cfg.nodes;
    const graph = el<HTMLElement>("graph");
    expect(graph.tabIndex).toBe(0);

    press(graph, "ArrowDown");
    expect(mounted.app.selectedBlock()).toBe(nodes[0]!.id);
    press(graph, "ArrowDown");
    expect(mounted.app.selectedBlock()).toBe(nodes[1]!.id);
    press(graph, "ArrowUp");
    expect(mounted.app.selectedBlock()).toBe(nodes[0]!.id);
    press(graph, "End");
    expect(mounted.app.selectedBlock()).toBe(nodes.at(-1)!.id);
    expect(el("graph-status").textContent).toMatch(/x86 instructions/);
  });

  it("zooms and fits from the graph", () => {
    const graph = el("graph");
    press(graph, "+");
    press(graph, "-");
    press(graph, "0");
    expect(mounted.graph.zoomFactors).toHaveLength(2);
    expect(mounted.graph.fits).toBe(1);
  });

});

describe("failures stay visible instead of breaking the page", () => {
  it("shows an error with a retry when a variant cannot be fetched", async () => {
    const control = makeLoader();
    mounted = await mountApp(control);
    const target = fileOf("o3-bcf1-fla0-sub0-str0-split0");
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
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla0-sub0-str0-split0");
    expect(numberIn(metricCell("instructions"), "current")).toBe(
      onDisk("o3-bcf1-fla0-sub0-str0-split0").metrics.instruction_count,
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
    expect(mounted.app.variant()?.id).toBe("o3-bcf1-fla0-sub0-str0-split0");
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

describe("the source and the assembly, side by side", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("shows source.c unchanged, without waiting to be asked", () => {
    const source = readFileSync(resolve("web_data/source.c"), "utf8");
    // The plain-English notes live in their own spans; what is rendered as
    // code is still the exact bytes that were compiled.
    const rendered = [...document.querySelectorAll(".c-code")]
      .map((node) => node.textContent)
      .join("\n");
    expect(rendered).toBe(source.replace(/\n+$/, ""));
    expect(mounted.control.requests).toContain("source.c");
    const lines = source.replace(/\n+$/, "").split("\n").length;
    expect(el("source-note").textContent).toContain(`${lines} lines`);
    expect(el("source-note").textContent).toMatch(/all 256 variants/);
  });

  it("annotates the source without putting the notes in the code", () => {
    const notes = [...document.querySelectorAll(".c-note")];
    expect(notes.length).toBeGreaterThan(8);
    // Every note is a comment, in its own span, on a file that has none of its
    // own — so the code beside it stays the bytes that were compiled.
    for (const note of notes) expect(note.textContent).toMatch(/^\s*\/\//);
    expect(document.querySelectorAll(".c-code .c-note")).toHaveLength(0);
    expect(el("source-note").textContent).not.toMatch(/no longer match/);
  });

  it("labels the two panes for a reader who does not know the difference", async () => {
    expect(el("source-role").textContent?.trim()).toBe("What the human wrote");
    expect(el("asm-role").textContent?.trim()).toBe(
      "What the CPU executes — without obfuscation",
    );
    await setControls(mounted.app, { bcf: true, split_level: 2 });
    expect(el("asm-role").textContent).toContain("2 transformations on");
  });

  it("leaves the source alone as the configuration changes", async () => {
    const before = el("source").textContent;
    await setControls(mounted.app, {
      optimization: "O3",
      bcf: true,
      flattening: true,
      substitution: true,
      string_encryption: true,
      split_level: 4,
    });
    expect(el("source").textContent).toBe(before);
  });

  it("prints the whole function, verbatim, for the selected variant", async () => {
    for (const id of [CLEAN, "o0-bcf1-fla0-sub0-str0-split0"]) {
      const expected = onDisk(id);
      await setControls(mounted.app, expected.config);

      const lines = [...el("asm-full").querySelectorAll(".asm-line")];
      expect(lines, id).toHaveLength(expected.metrics.instruction_count);
      expected.disassembly.instructions.forEach((instruction, i) => {
        const reloc =
          instruction.relocations.length > 0
            ? `; ${instruction.relocations.map((r) => r.symbol).join(", ")}`
            : "";
        expect(lines[i]!.textContent, `${id}#${i}`).toBe(
          `${instruction.address_hex}${instruction.mnemonic}${instruction.op_str}${reloc}`,
        );
      });
      expect(el("asm-full-note").textContent).toContain(
        expected.metrics.instruction_count.toLocaleString("en-AU"),
      );
      expect(el("asm-full-note").textContent).toContain(
        expected.metrics.main_byte_size.toLocaleString("en-AU"),
      );
    }
  });
});

describe("the build command", () => {
  beforeEach(async () => {
    mounted = await mountApp();
  });

  it("is a plain clang line when nothing is switched on", () => {
    const text = el("cli").textContent ?? "";
    expect(text).toContain("clang");
    expect(text).toContain("-target x86_64-pc-windows-msvc");
    expect(text).toContain("-O3");
    expect(text).not.toContain("-mllvm");
    expect(text).toContain("# no obfuscation passes enabled");
    // One line: no backslash continuations.
    expect(text).not.toContain("\\");
    expect(text.split("\n").filter((line) => line.trim())).toHaveLength(1);
  });

  it("adds one flag per transformation, in control order", async () => {
    await setControls(mounted.app, {
      bcf: true,
      flattening: true,
      substitution: true,
      string_encryption: true,
    });
    const flags = [...el("cli").querySelectorAll(".cli-flag")].map(
      (node) => node.textContent,
    );
    expect(flags).toEqual([
      "-mllvm -enable-bcfobf",
      "-mllvm -bcf_prob=100",
      "-mllvm -enable-cffobf",
      "-mllvm -enable-subobf",
      "-mllvm -enable-strcry",
    ]);
  });

  it("carries the split level into the command", async () => {
    await setControls(mounted.app, { split_level: 3 });
    const text = el("cli").textContent ?? "";
    expect(text).toContain("-mllvm -enable-splitobf");
    expect(text).toContain("-mllvm -split_num=3");

    await setControls(mounted.app, { split_level: 0 });
    expect(el("cli").textContent).not.toContain("split_num");
  });

  it("tracks the optimization level", async () => {
    await setControls(mounted.app, { optimization: "O2" });
    expect(el("cli").textContent).toContain("-O2");
    expect(el("cli").textContent).not.toContain("-O3");
  });

  it("still describes the configuration when the variant fails to load", async () => {
    const control = makeLoader();
    mounted.app.destroy();
    mounted = await mountApp(control);
    control.failures.add(fileOf("o3-bcf1-fla0-sub0-str0-split0"));
    await setControls(mounted.app, { bcf: true });
    expect(mounted.app.variant()).toBeNull();
    expect(el("cli").textContent).toContain("-mllvm -enable-bcfobf");
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
    expect(text).toContain("ChandHsu/Hikari-LLVM15");
  });
});
