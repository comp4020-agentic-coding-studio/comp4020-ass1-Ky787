// Contract: the shipped markup offers the controls the brief asks for, and
// offers them to a keyboard and a screen reader as well as to a mouse.
// Runs against dist/, so it checks what is deployed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const doc = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8")).window
  .document;

function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return el.textContent?.trim() ?? "";
}

describe("the page states its one idea", () => {
  it("leads with the site's name", () => {
    expect(doc.querySelector("h1")?.textContent?.trim()).toBe(
      "Assembly Obfuscation Explorer",
    );
    expect(doc.title).toBe("Assembly Obfuscation Explorer");
  });

  it("says what to do next", () => {
    const sub = (doc.querySelector('[data-testid="thesis"]')?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    expect(sub).toContain("the program doesn't change");
    expect(sub).toContain("harder to reason about");

    const lede = (doc.querySelector(".masthead__lede")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(lede).toContain("never changes");
  });

  it("puts that line under the controls, not in the masthead", () => {
    const order = [...doc.body.children].map((el) => el.className || el.tagName);
    const dock = order.indexOf("dock");
    const thesis = order.indexOf("thesis");
    expect(dock).toBeGreaterThan(-1);
    expect(thesis).toBe(dock + 1);
    // Outside the sticky dock on purpose: --dock-h is subtracted from the
    // graph's height, so anything inside the dock is taken off the graph.
    expect(doc.querySelector('.dock [data-testid="thesis"]')).toBeNull();
    expect(doc.querySelector('.masthead [data-testid="thesis"]')).toBeNull();
  });

  it("describes itself for a link preview", () => {
    const description = doc
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    expect(description?.length ?? 0).toBeGreaterThan(40);
  });

  it("ships no dataset in the HTML", () => {
    const html = readFileSync(resolve("dist/index.html"), "utf8");
    expect(html).not.toContain("llvm_cfg");
    expect(html).not.toContain("instruction_count");
  });
});

describe("controls", () => {
  const transforms = [
    ["bcf", "Bogus Control Flow"],
    ["flattening", "Control Flow Flattening"],
    ["substitution", "Instruction Substitution"],
    ["string_encryption", "String Encryption"],
  ] as const;

  for (const [key, label] of transforms) {
    it(`offers a labelled switch for ${label}`, () => {
      const input = doc.querySelector<HTMLInputElement>(
        `input[data-transform="${key}"]`,
      );
      expect(input?.type).toBe("checkbox");
      expect(input?.closest("label")?.textContent).toContain(label);
    });
  }

  it("offers Off / 2 / 3 / 4 for basic block splitting", () => {
    const values = [
      ...doc.querySelectorAll<HTMLInputElement>('input[name="split"]'),
    ].map((input) => input.value);
    expect(values).toEqual(["0", "2", "3", "4"]);
    const labels = [
      ...doc.querySelectorAll('[data-testid="split-group"] .segmented__opt span'),
    ].map((span) => span.textContent);
    expect(labels).toEqual(["Off", "2", "3", "4"]);
    expect(
      doc
        .querySelector('[data-testid="split-group"]')
        ?.closest("fieldset")
        ?.querySelector("legend")?.textContent,
    ).toContain("Basic Block Splitting");
  });

  it("offers optimization highest-first, so both scales run clean to noisy", () => {
    const values = [
      ...doc.querySelectorAll<HTMLInputElement>('input[name="opt"]'),
    ].map((input) => input.value);
    expect(values).toEqual(["O3", "O2", "O1", "O0"]);
    expect(
      doc
        .querySelector('[data-testid="opt-group"]')
        ?.closest("fieldset")
        ?.querySelector("legend")?.textContent,
    ).toContain("Compiler Optimization");
  });

  it("starts clean, at O3", () => {
    for (const input of doc.querySelectorAll<HTMLInputElement>(
      "input[data-transform]",
    )) {
      expect(input.hasAttribute("checked")).toBe(false);
    }
    expect(
      doc.querySelector<HTMLInputElement>('input[name="split"][value="0"]')
        ?.hasAttribute("checked"),
    ).toBe(true);
    expect(
      doc.querySelector<HTMLInputElement>('input[name="opt"][value="O3"]')
        ?.hasAttribute("checked"),
    ).toBe(true);
  });

  it("offers both CFGs, with x86 selected", () => {
    const views = [
      ...doc.querySelectorAll<HTMLInputElement>('input[name="view"]'),
    ];
    expect(views.map((v) => v.value)).toEqual(["x86", "ir"]);
    expect(views[0]?.hasAttribute("checked")).toBe(true);
  });

  it("offers a reset", () => {
    const reset = doc.querySelector('[data-testid="reset"]');
    expect(reset?.tagName).toBe("BUTTON");
    expect(reset?.textContent?.trim()).toBe("Reset");
  });
});

describe("the graph is reachable without a mouse", () => {
  const canvas = doc.querySelector('[data-testid="graph"]')!;

  it("takes focus and announces what it is", () => {
    expect(canvas.getAttribute("tabindex")).toBe("0");
    expect(accessibleName(canvas).length).toBeGreaterThan(0);
    const described = canvas.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(doc.getElementById(described!)?.textContent).toMatch(/arrow keys/i);
  });

  it("names every view control", () => {
    const buttons = [...doc.querySelectorAll(".graph-tools button")];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(accessibleName(button), button.outerHTML).not.toBe("");
    }
    expect(accessibleName(doc.querySelector(".graph-tools")!)).not.toBe("");
  });

  it("has a live region for the selected block", () => {
    expect(
      doc.querySelector('[data-testid="graph-status"]')?.getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("has a legend the script fills for whichever CFG is shown", () => {
    // The kinds differ between the two CFGs, so the legend is rendered rather
    // than hard-coded; spec/app.test.ts checks what goes into it.
    const legend = doc.querySelector('[data-testid="legend"]');
    expect(legend).toBeTruthy();
    expect(legend?.children).toHaveLength(0);
  });
});

describe("wiring holds together", () => {
  it("resolves every aria reference to a real element", () => {
    const attributes = ["aria-labelledby", "aria-describedby", "aria-controls"];
    for (const attribute of attributes) {
      for (const el of doc.querySelectorAll(`[${attribute}]`)) {
        for (const id of (el.getAttribute(attribute) ?? "").split(/\s+/)) {
          expect(doc.getElementById(id), `${attribute}="${id}"`).toBeTruthy();
        }
      }
    }
  });

  it("points the skip link at the graph", () => {
    const href = doc.querySelector(".skip-link")?.getAttribute("href") ?? "";
    expect(href.startsWith("#")).toBe(true);
    expect(doc.getElementById(href.slice(1))).toBeTruthy();
  });

  it("puts the source and the assembly side by side", () => {
    const panes = [...doc.querySelectorAll(".diptych .pane")];
    expect(panes).toHaveLength(2);
    expect(panes[0]?.querySelector(".pane__name")?.textContent).toContain(
      "source.c",
    );
    expect(panes[1]?.querySelector(".pane__name")?.textContent).toContain("x86");
    for (const pane of panes) {
      // Long lines scroll inside the pane, never widening the page.
      expect(pane.querySelector("pre.code")?.getAttribute("tabindex")).toBe("0");
    }
  });

  it("labels each pane for a reader who cannot tell them apart", () => {
    const human = doc.querySelector('[data-testid="source-role"]');
    const machine = doc.querySelector('[data-testid="asm-role"]');
    expect(human?.textContent?.trim()).toBe("What the human wrote");
    expect(machine?.textContent?.trim()).toContain("What the CPU executes");
    // Different classes, so they can carry different colours.
    expect(human?.className).not.toBe(machine?.className);
  });

  it("offers a hint beside everything a newcomer would trip on", () => {
    const keys = [...doc.querySelectorAll("[data-hint]")].map(
      (slot) => slot.getAttribute("data-hint"),
    );
    for (const needed of [
      "bcf",
      "flattening",
      "substitution",
      "string_encryption",
      "split",
      "optimization",
      "graph",
      "source",
      "disassembly",
      "instructions",
      "strings",
    ]) {
      expect(keys, `no hint for ${needed}`).toContain(needed);
    }
  });

  it("gives the stage to the metrics and the graph, and nothing else", () => {
    const children = [...(doc.querySelector(".stage")?.children ?? [])].filter(
      (el) => !el.classList.contains("sr-only"),
    );
    expect(children.map((el) => el.className)).toEqual([
      "metrics__grid",
      "workspace",
    ]);
    expect(doc.querySelector(".workspace .graph-panel")).toBeTruthy();
  });

  it("shows the build command and offers to copy it", () => {
    expect(doc.querySelector('[data-testid="cli"]')?.tagName).toBe("PRE");
    expect(doc.querySelector('[data-testid="cli-copy"]')?.tagName).toBe(
      "BUTTON",
    );
  });

  it("names the toolchain the command belongs to", () => {
    const note = doc
      .querySelector('[data-testid="cli"]')
      ?.closest("section")
      ?.querySelector(".panel__note")?.textContent;
    expect(note?.replace(/\s+/g, " ")).toMatch(/hikari llvm 15/i);
  });

  it("pins the controls so they stay with the graph", () => {
    const dock = doc.querySelector('[data-testid="dock"]');
    expect(dock).toBeTruthy();
    expect(dock?.querySelector('[data-testid="reset"]')).toBeTruthy();
    expect(dock?.querySelector("input[data-transform]")).toBeTruthy();
  });

  it("keeps the compiler detail secondary", () => {
    const tech = doc.querySelector('[data-testid="tech"]');
    expect(tech?.tagName).toBe("DETAILS");
    expect(tech?.hasAttribute("open")).toBe(false);
    expect(tech?.querySelector("summary")?.textContent?.trim()).toBe(
      "Technical details",
    );
  });
});
