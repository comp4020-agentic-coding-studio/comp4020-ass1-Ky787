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
  it("leads with the headline", () => {
    expect(doc.querySelector("h1")?.textContent?.trim().toLowerCase()).toBe(
      "the program didn't change",
    );
  });

  it("says what to do next", () => {
    const sub = (doc.querySelector(".masthead__sub")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    expect(sub).toContain("transformations");
    expect(sub).toContain("harder to reason about");

    const lede = (doc.querySelector(".masthead__lede")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(lede).toContain("never changes");
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

  it("offers O0 / O1 / O2 / O3 for optimization", () => {
    const values = [
      ...doc.querySelectorAll<HTMLInputElement>('input[name="opt"]'),
    ].map((input) => input.value);
    expect(values).toEqual(["O0", "O1", "O2", "O3"]);
    expect(
      doc
        .querySelector('[data-testid="opt-group"]')
        ?.closest("fieldset")
        ?.querySelector("legend")?.textContent,
    ).toContain("Compiler Optimization");
  });

  it("starts from the clean configuration", () => {
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
      doc.querySelector<HTMLInputElement>('input[name="opt"][value="O0"]')
        ?.hasAttribute("checked"),
    ).toBe(true);
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

  it("explains edge kinds in words, not only in colour", () => {
    const items = [...doc.querySelectorAll(".legend__item")];
    expect(items).toHaveLength(7);
    for (const item of items) {
      expect(item.textContent?.trim()).not.toBe("");
    }
    const kinds = items
      .map((item) => item.getAttribute("data-kind"))
      .filter(Boolean);
    expect(kinds).toEqual(["true", "false", "branch", "case", "default"]);
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

  it("gives the inspector a tablist with two panels", () => {
    const tabs = [...doc.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "LLVM IR",
      "x86",
    ]);
    for (const tab of tabs) {
      const panel = doc.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
    }
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
