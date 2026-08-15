// Contract: the build command shown on the page follows the configuration
// exactly — one flag per switch, in control order, and nothing extra.
//
// This is the one part of the page that is a reconstruction rather than a
// reading of web_data/, so what it can be trusted for is narrow: that it is a
// faithful function of the six controls, and that it never quietly grows a flag
// the controls did not ask for. The page labels it as reconstructed.

import { describe, expect, it } from "vitest";
import {
  TARGET_TRIPLE,
  buildCommand,
  commandText,
  obfuscatingFlagCount,
} from "../src/command.js";
import { BASELINE_CONFIG, OPTIMIZATION_LEVELS, SPLIT_LEVELS } from "../src/dataset.js";
import type { VariantConfig } from "../src/types.js";

const TRANSFORMS = [
  "bcf",
  "flattening",
  "substitution",
  "string_encryption",
] as const;

describe("the clean configuration", () => {
  it("is a plain clang invocation", () => {
    expect(commandText(BASELINE_CONFIG)).toBe(
      `clang -target ${TARGET_TRIPLE} -O0 -c source.c -o main.o`,
    );
  });

  it("carries no -mllvm flags at all", () => {
    expect(obfuscatingFlagCount(BASELINE_CONFIG)).toBe(0);
    expect(commandText(BASELINE_CONFIG)).not.toContain("-mllvm");
  });
});

describe("each control adds exactly its own flag", () => {
  const flags: Record<(typeof TRANSFORMS)[number], string> = {
    bcf: "-mllvm -enable-bcfobf",
    flattening: "-mllvm -enable-cffobf",
    substitution: "-mllvm -enable-subobf",
    string_encryption: "-mllvm -enable-strcry",
  };

  for (const key of TRANSFORMS) {
    it(`${key} adds ${flags[key]} and nothing else`, () => {
      const command = commandText({ ...BASELINE_CONFIG, [key]: true });
      expect(command).toContain(flags[key]);
      expect(obfuscatingFlagCount({ ...BASELINE_CONFIG, [key]: true })).toBe(1);
      for (const other of TRANSFORMS) {
        if (other !== key) expect(command).not.toContain(flags[other]);
      }
    });
  }

  it("keeps the switches in the order the controls present them", () => {
    const all: VariantConfig = {
      ...BASELINE_CONFIG,
      bcf: true,
      flattening: true,
      substitution: true,
      string_encryption: true,
    };
    expect(
      buildCommand(all)
        .filter((part) => part.obfuscating)
        .map((part) => part.text),
    ).toEqual(TRANSFORMS.map((key) => flags[key]));
  });

  for (const level of SPLIT_LEVELS) {
    it(`split ${level === 0 ? "Off" : level} ${level === 0 ? "adds nothing" : "sets split_num"}`, () => {
      const command = commandText({ ...BASELINE_CONFIG, split_level: level });
      if (level === 0) {
        expect(command).not.toContain("splitobf");
        expect(command).not.toContain("split_num");
      } else {
        expect(command).toContain("-mllvm -enable-splitobf");
        expect(command).toContain(`-mllvm -split_num=${level}`);
      }
    });
  }

  for (const level of OPTIMIZATION_LEVELS) {
    it(`${level} is passed through as -${level}`, () => {
      const parts = buildCommand({ ...BASELINE_CONFIG, optimization: level });
      expect(parts.map((part) => part.text)).toContain(`-${level}`);
      expect(parts.filter((part) => /^-O\d$/.test(part.text))).toHaveLength(1);
    });
  }
});

describe("no flag appears that a control did not ask for", () => {
  it("holds across every configuration", () => {
    const known = new Set([
      "-mllvm -enable-bcfobf",
      "-mllvm -enable-cffobf",
      "-mllvm -enable-subobf",
      "-mllvm -enable-strcry",
      "-mllvm -enable-splitobf",
      "-mllvm -split_num=2",
      "-mllvm -split_num=3",
      "-mllvm -split_num=4",
    ]);
    for (const optimization of OPTIMIZATION_LEVELS) {
      for (const split_level of SPLIT_LEVELS) {
        for (const mask of [0, 1, 2, 4, 8, 15]) {
          const config: VariantConfig = {
            optimization,
            split_level,
            bcf: Boolean(mask & 1),
            flattening: Boolean(mask & 2),
            substitution: Boolean(mask & 4),
            string_encryption: Boolean(mask & 8),
          };
          const parts = buildCommand(config);
          const expected =
            TRANSFORMS.filter((key) => config[key]).length +
            (split_level === 0 ? 0 : 2);
          expect(obfuscatingFlagCount(config), JSON.stringify(config)).toBe(
            expected,
          );
          for (const part of parts.filter((p) => p.obfuscating)) {
            expect(known.has(part.text), part.text).toBe(true);
          }
        }
      }
    }
  });

  it("never invents a seed flag: nothing in the dataset records one", () => {
    for (const optimization of OPTIMIZATION_LEVELS) {
      const command = commandText({ ...BASELINE_CONFIG, optimization });
      expect(command).not.toMatch(/seed/i);
      expect(command).not.toContain("12345");
    }
  });
});
