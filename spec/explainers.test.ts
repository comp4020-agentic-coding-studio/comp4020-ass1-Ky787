// @vitest-environment jsdom
//
// Contract: the two things on this page written for a reader rather than read
// from the dataset — the plain-English notes beside source.c, and the
// question-mark hints — say what they mean and never alter what they explain.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ANNOTATIONS, annotate } from "../src/annotations.js";
import { HINTS, mountHints } from "../src/hints.js";

const SOURCE = readFileSync(resolve("web_data/source.c"), "utf8");

describe("the notes beside the source", () => {
  const annotated = annotate(SOURCE);

  it("leaves the code exactly as the dataset has it", () => {
    expect(annotated.lines.map((line) => line.code).join("\n")).toBe(
      SOURCE.replace(/\n+$/, ""),
    );
  });

  it("still matches the source it was written against", () => {
    expect(annotated.unmatched).toEqual([]);
  });

  it("puts every note on its own line, and none twice", () => {
    const noted = annotated.lines.filter((line) => line.note !== undefined);
    expect(noted).toHaveLength(ANNOTATIONS.length);
    const texts = noted.map((line) => line.note);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("puts each note on a line that actually contains its subject", () => {
    for (const { match, note } of ANNOTATIONS) {
      const line = annotated.lines.find((l) => l.note === note);
      expect(line?.code, note).toContain(match);
    }
  });

  it("reports a drifted source instead of moving notes onto the wrong line", () => {
    const drifted = annotate("int main(void)\n{\n    return 0;\n}");
    expect(drifted.unmatched.length).toBeGreaterThan(0);
    expect(drifted.lines.map((l) => l.code).join("\n")).toBe(
      "int main(void)\n{\n    return 0;\n}",
    );
  });
});

describe("the question-mark hints", () => {
  function mount(keys: string[]): HTMLElement {
    document.body.replaceChildren();
    const host = document.createElement("div");
    host.innerHTML = keys
      .map((key) => `<span data-hint="${key}"></span>`)
      .join("");
    document.body.append(host);
    mountHints(document);
    return host;
  }

  it("explains every thing it offers a button for, in plain words", () => {
    for (const [key, hint] of Object.entries(HINTS)) {
      expect(hint.title.length, key).toBeGreaterThan(2);
      expect(hint.body.length, key).toBeGreaterThan(40);
      expect(hint.body.length, key).toBeLessThan(320);
      expect(hint.body.trim().endsWith("."), key).toBe(true);
    }
  });

  it("gives each button a name and ties it to its explanation", () => {
    mount(["bcf", "flattening"]);
    const buttons = [...document.querySelectorAll<HTMLElement>(".hint__btn")];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label")).toMatch(/^What is .+\?$/);
      const described = button.getAttribute("aria-describedby") ?? "";
      const bubble = document.getElementById(described);
      expect(bubble?.getAttribute("role")).toBe("tooltip");
      expect(bubble?.textContent?.length ?? 0).toBeGreaterThan(40);
    }
    expect(buttons[0]?.getAttribute("aria-label")).toBe(
      "What is Bogus Control Flow?",
    );
  });

  it("opens on focus and closes again on blur", () => {
    mount(["graph"]);
    const button = document.querySelector<HTMLElement>(".hint__btn")!;
    const wrapper = button.closest(".hint")!;
    expect(wrapper.getAttribute("data-open")).toBe("false");
    button.dispatchEvent(new window.FocusEvent("focus"));
    expect(wrapper.getAttribute("data-open")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.dispatchEvent(new window.FocusEvent("blur"));
    expect(wrapper.getAttribute("data-open")).toBe("false");
  });

  it("stays open when a hover is followed by a click", () => {
    mount(["graph"]);
    const button = document.querySelector<HTMLElement>(".hint__btn")!;
    const wrapper = button.closest(".hint")! as HTMLElement;
    wrapper.dispatchEvent(new window.MouseEvent("mouseenter"));
    expect(wrapper.getAttribute("data-open")).toBe("true");
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(wrapper.getAttribute("data-open")).toBe("true");
    // Pinned by the click, so moving the pointer away leaves it up.
    wrapper.dispatchEvent(new window.MouseEvent("mouseleave"));
    expect(wrapper.getAttribute("data-open")).toBe("true");
  });

  it("closes on Escape", () => {
    mount(["graph"]);
    const button = document.querySelector<HTMLElement>(".hint__btn")!;
    const wrapper = button.closest(".hint")!;
    button.dispatchEvent(new window.FocusEvent("focus"));
    button.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(wrapper.getAttribute("data-open")).toBe("false");
  });

  it("does not flip the switch it is sitting inside", () => {
    document.body.replaceChildren();
    const label = document.createElement("label");
    label.className = "switch";
    label.innerHTML =
      '<input type="checkbox" data-transform="bcf" /><span data-hint="bcf"></span>';
    document.body.append(label);
    mountHints(document);

    const input = label.querySelector<HTMLInputElement>("input")!;
    const button = label.querySelector<HTMLElement>(".hint__btn")!;
    expect(input.checked).toBe(false);
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(input.checked, "clicking the hint must not toggle the switch").toBe(
      false,
    );
  });

  it("tears its listeners down with the app", () => {
    mount(["graph"]);
    const teardown = mountHints(document);
    teardown();
    expect(document.querySelectorAll(".hint__btn").length).toBeGreaterThan(0);
  });
});
