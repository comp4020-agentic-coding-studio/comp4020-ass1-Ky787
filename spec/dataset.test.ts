// Contract: the controls must resolve to the right variant, and the numbers the
// page shows must be the numbers in the files.
//
// This suite never constructs an id or a path to prove a mapping — it looks the
// configuration up the way the app does and then checks the answer against the
// dataset's own naming, so a drifting dataset fails loudly instead of silently
// serving a neighbouring variant.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { operandRanges } from "../src/asm.js";
import {
  BASELINE_CONFIG,
  Dataset,
  DatasetError,
  METRIC_KEYS,
  OPTIMIZATION_LEVELS,
  SPLIT_LEVELS,
  configKey,
  type DataLoader,
} from "../src/dataset.js";
import type { Variant, VariantConfig } from "../src/types.js";

const DATA_DIR = resolve("web_data");

const loader: DataLoader = {
  json: async (path) => JSON.parse(readFileSync(join(DATA_DIR, path), "utf8")),
  text: async (path) => readFileSync(join(DATA_DIR, path), "utf8"),
};

const dataset = await Dataset.open(loader);

function everyConfig(): VariantConfig[] {
  const configs: VariantConfig[] = [];
  for (const optimization of OPTIMIZATION_LEVELS) {
    for (const bcf of [false, true]) {
      for (const flattening of [false, true]) {
        for (const substitution of [false, true]) {
          for (const string_encryption of [false, true]) {
            for (const split_level of SPLIT_LEVELS) {
              configs.push({
                optimization,
                bcf,
                flattening,
                substitution,
                string_encryption,
                split_level,
              });
            }
          }
        }
      }
    }
  }
  return configs;
}

/** The id the dataset's own naming scheme implies for a configuration. */
function expectedId(config: VariantConfig): string {
  return [
    config.optimization.toLowerCase(),
    `bcf${config.bcf ? 1 : 0}`,
    `fla${config.flattening ? 1 : 0}`,
    `sub${config.substitution ? 1 : 0}`,
    `str${config.string_encryption ? 1 : 0}`,
    `split${config.split_level}`,
  ].join("-");
}

describe("the index covers the experiment", () => {
  it("declares 256 variants and lists 256 variants", () => {
    expect(dataset.index.variant_count).toBe(256);
    expect(dataset.index.variants).toHaveLength(256);
  });

  it("offers exactly the four dimensions the controls expose", () => {
    expect(dataset.index.dimensions.optimization_levels).toEqual([
      "O0",
      "O1",
      "O2",
      "O3",
    ]);
    expect(dataset.index.dimensions.split_levels).toEqual([0, 2, 3, 4]);
    expect(dataset.index.dimensions.boolean_transformations).toEqual([
      "bcf",
      "flattening",
      "substitution",
      "string_encryption",
    ]);
  });

  it("gives every configuration exactly one variant", () => {
    const configs = everyConfig();
    expect(configs).toHaveLength(256);
    const seen = new Set<string>();
    for (const config of configs) {
      const entry = dataset.lookup(config);
      expect(entry.config).toEqual(config);
      expect(seen.has(entry.id)).toBe(false);
      seen.add(entry.id);
    }
    expect(seen.size).toBe(256);
  });

  it("names every variant the way its configuration says it should", () => {
    for (const config of everyConfig()) {
      expect(dataset.lookup(config).id).toBe(expectedId(config));
    }
  });

  it("points every variant at a file that exists", () => {
    for (const entry of dataset.index.variants) {
      expect(existsSync(join(DATA_DIR, entry.file)), entry.file).toBe(true);
    }
  });

  it("refuses a configuration it does not hold", () => {
    expect(() =>
      dataset.lookup({ ...BASELINE_CONFIG, split_level: 5 as 4 }),
    ).toThrow(DatasetError);
  });
});

describe("each control moves exactly one axis", () => {
  it("starts from the clean O0 variant", () => {
    expect(dataset.baseline.id).toBe("o0-bcf0-fla0-sub0-str0-split0");
    expect(dataset.baseline.config).toEqual(BASELINE_CONFIG);
  });

  const booleans = [
    ["bcf", "o0-bcf1-fla0-sub0-str0-split0"],
    ["flattening", "o0-bcf0-fla1-sub0-str0-split0"],
    ["substitution", "o0-bcf0-fla0-sub1-str0-split0"],
    ["string_encryption", "o0-bcf0-fla0-sub0-str1-split0"],
  ] as const;

  for (const [key, id] of booleans) {
    it(`maps ${key} on to ${id}`, () => {
      expect(dataset.lookup({ ...BASELINE_CONFIG, [key]: true }).id).toBe(id);
    });
  }

  for (const level of SPLIT_LEVELS) {
    it(`maps split ${level === 0 ? "Off" : level} to split${level}`, () => {
      expect(dataset.lookup({ ...BASELINE_CONFIG, split_level: level }).id).toBe(
        `o0-bcf0-fla0-sub0-str0-split${level}`,
      );
    });
  }

  for (const level of OPTIMIZATION_LEVELS) {
    it(`maps ${level} to ${level.toLowerCase()}-...`, () => {
      expect(
        dataset.lookup({ ...BASELINE_CONFIG, optimization: level }).id,
      ).toBe(`${level.toLowerCase()}-bcf0-fla0-sub0-str0-split0`);
    });
  }

  it("maps combinations, not just single axes", () => {
    expect(
      dataset.lookup({
        optimization: "O2",
        bcf: true,
        flattening: false,
        substitution: true,
        string_encryption: false,
        split_level: 3,
      }).id,
    ).toBe("o2-bcf1-fla0-sub1-str0-split3");

    expect(
      dataset.lookup({
        optimization: "O3",
        bcf: true,
        flattening: true,
        substitution: true,
        string_encryption: true,
        split_level: 4,
      }).id,
    ).toBe("o3-bcf1-fla1-sub1-str1-split4");
  });

  it("keys configurations without collisions", () => {
    const keys = new Set(everyConfig().map(configKey));
    expect(keys.size).toBe(256);
  });
});

describe("the files agree with the index and with themselves", () => {
  const variants = dataset.index.variants.map((entry) => ({
    entry,
    variant: JSON.parse(
      readFileSync(join(DATA_DIR, entry.file), "utf8"),
    ) as Variant,
  }));

  it("reads all 256 variant files", () => {
    expect(variants).toHaveLength(256);
  });

  it("gives each file the id and config the index promised", () => {
    for (const { entry, variant } of variants) {
      expect(variant.id, entry.file).toBe(entry.id);
      expect(variant.source_variant_id, entry.file).toBe(entry.source_variant_id);
      expect(variant.config, entry.file).toEqual(entry.config);
    }
  });

  it("repeats the index metrics exactly", () => {
    for (const { entry, variant } of variants) {
      for (const key of METRIC_KEYS) {
        expect(variant.metrics[key], `${entry.id}.${key}`).toBe(
          entry.metrics[key],
        );
      }
    }
  });

  it("counts its own blocks, edges and instructions correctly", () => {
    for (const { entry, variant } of variants) {
      expect(variant.llvm_cfg.nodes.length, entry.id).toBe(
        variant.metrics.llvm_basic_block_count,
      );
      expect(variant.llvm_cfg.edges.length, entry.id).toBe(
        variant.metrics.llvm_cfg_edge_count,
      );
      expect(variant.machine_cfg.nodes.length, entry.id).toBe(
        variant.metrics.machine_basic_block_count,
      );
      expect(variant.machine_cfg.edges.length, entry.id).toBe(
        variant.metrics.machine_cfg_edge_count,
      );
      expect(variant.disassembly.instructions.length, entry.id).toBe(
        variant.metrics.instruction_count,
      );
    }
  });

  it("never points an edge at a block it does not have", () => {
    for (const { entry, variant } of variants) {
      const llvmIds = new Set(variant.llvm_cfg.nodes.map((n) => n.id));
      expect(llvmIds.has(variant.llvm_cfg.entry_node_id), entry.id).toBe(true);
      for (const edge of variant.llvm_cfg.edges) {
        expect(llvmIds.has(edge.source), `${entry.id} ${edge.source}`).toBe(true);
        expect(llvmIds.has(edge.target), `${entry.id} ${edge.target}`).toBe(true);
      }
      const machineIds = new Set(variant.machine_cfg.nodes.map((n) => n.id));
      for (const edge of variant.machine_cfg.edges) {
        expect(machineIds.has(edge.source), entry.id).toBe(true);
        expect(machineIds.has(edge.target), entry.id).toBe(true);
      }
    }
  });

  it("resolves every machine block's addresses to a real instruction", () => {
    for (const { entry, variant } of variants) {
      const addresses = new Set(
        variant.disassembly.instructions.map((i) => i.address),
      );
      for (const node of variant.machine_cfg.nodes) {
        for (const address of node.instruction_addresses) {
          expect(addresses.has(address), `${entry.id} @${address}`).toBe(true);
        }
      }
    }
  });

  it("watches the same three strings in every variant", () => {
    const expected = ["ACCESS GRANTED", "ACCESS DENIED", "result=%u"];
    for (const { entry, variant } of variants) {
      expect(Object.keys(variant.watched_plaintext_strings).sort(), entry.id)
        .toEqual([...expected].sort());
    }
  });

  it("only uses edge kinds the legend explains", () => {
    const llvmKinds = new Set<string>();
    const machineKinds = new Set<string>();
    for (const { variant } of variants) {
      for (const edge of variant.llvm_cfg.edges) llvmKinds.add(edge.kind);
      for (const edge of variant.machine_cfg.edges) machineKinds.add(edge.kind);
    }
    expect([...llvmKinds].sort()).toEqual([
      "branch",
      "case",
      "default",
      "false",
      "true",
    ]);
    expect([...machineKinds].sort()).toEqual(["branch", "fallthrough", "jump"]);
  });

  it("prints every instruction back exactly as Capstone wrote it", () => {
    // The renderer colours operands by splitting op_str at top-level commas and
    // pairing the pieces with the structured operand list. If that pairing ever
    // slipped, the colours would be lying about the text; if the pieces ever
    // failed to reassemble into op_str, the text itself would be wrong.
    let checked = 0;
    let unpaired = 0;
    for (const { variant } of variants) {
      for (const instruction of variant.disassembly.instructions) {
        const ranges = operandRanges(instruction.op_str);
        checked += 1;
        if (ranges.length !== instruction.operands.length) {
          unpaired += 1;
          continue;
        }
        let rebuilt = "";
        let cursor = 0;
        for (const range of ranges) {
          rebuilt += instruction.op_str.slice(cursor, range.end);
          cursor = range.end;
        }
        rebuilt += instruction.op_str.slice(cursor);
        expect(rebuilt).toBe(instruction.op_str);
      }
    }
    expect(checked).toBeGreaterThan(80_000);
    expect(unpaired).toBe(0);
  });

  it("knows the largest specimen the graph has to draw", () => {
    expect(dataset.maxima.llvm_basic_block_count).toBeGreaterThan(100);
    for (const key of METRIC_KEYS) {
      const observed = Math.max(
        ...variants.map(({ variant }) => variant.metrics[key]),
      );
      expect(dataset.maxima[key], key).toBe(observed);
    }
  });
});

describe("loading", () => {
  it("fetches a variant once and serves the rest from cache", async () => {
    const seen: string[] = [];
    const counting = await Dataset.open({
      json: async (path) => {
        seen.push(path);
        return loader.json(path);
      },
      text: loader.text,
    });
    const entry = counting.lookup({ ...BASELINE_CONFIG, bcf: true });
    expect(counting.cached(entry.id)).toBeUndefined();
    await counting.variant(entry);
    await counting.variant(entry);
    expect(counting.cached(entry.id)).toBeDefined();
    expect(seen.filter((path) => path === entry.file)).toHaveLength(1);
  });

  it("reports a missing variant file as a dataset error", async () => {
    const broken = await Dataset.open({
      json: async (path) =>
        path === "index.json"
          ? loader.json(path)
          : Promise.reject(new Error("HTTP 404")),
      text: loader.text,
    });
    await expect(broken.variant(broken.baseline)).rejects.toBeInstanceOf(
      DatasetError,
    );
  });
});
