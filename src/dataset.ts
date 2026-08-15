// Access to the pre-generated dataset.
//
// Two rules shape this module:
//  1. A configuration is resolved to a variant by LOOKING IT UP in index.json,
//     never by formatting an id or a file path. If a combination is absent the
//     lookup fails loudly instead of guessing a neighbour.
//  2. Only the selected variant is fetched, and fetched variants are cached, so
//     none of the 256 files reach the initial bundle.

import type {
  DatasetIndex,
  IndexVariant,
  OptimizationLevel,
  SplitLevel,
  Variant,
  VariantConfig,
  VariantMetrics,
} from "./types.js";

export class DatasetError extends Error {
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "DatasetError";
    this.detail = detail;
  }
}

/** Reads files from web_data/. Injected so tests can read from disk. */
export interface DataLoader {
  json(relativePath: string): Promise<unknown>;
  text(relativePath: string): Promise<string>;
}

/** The clean reference point: no transformations, no splitting, O0. */
export const BASELINE_CONFIG: VariantConfig = Object.freeze({
  optimization: "O0",
  bcf: false,
  flattening: false,
  substitution: false,
  string_encryption: false,
  split_level: 0,
});

export const OPTIMIZATION_LEVELS: readonly OptimizationLevel[] = [
  "O0",
  "O1",
  "O2",
  "O3",
];
export const SPLIT_LEVELS: readonly SplitLevel[] = [0, 2, 3, 4];

/** Canonical key for the six configuration dimensions. */
export function configKey(config: VariantConfig): string {
  return [
    config.optimization,
    config.bcf ? 1 : 0,
    config.flattening ? 1 : 0,
    config.substitution ? 1 : 0,
    config.string_encryption ? 1 : 0,
    config.split_level,
  ].join("/");
}

export const METRIC_KEYS = [
  "instruction_count",
  "main_byte_size",
  "machine_basic_block_count",
  "machine_cfg_edge_count",
  "llvm_basic_block_count",
  "llvm_cfg_edge_count",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertIndexShape(value: unknown): asserts value is DatasetIndex {
  if (!isRecord(value) || !Array.isArray(value.variants)) {
    throw new DatasetError(
      "web_data/index.json is not a dataset index",
      "expected an object with a `variants` array",
    );
  }
  if (value.variants.length === 0) {
    throw new DatasetError("web_data/index.json lists no variants");
  }
}

function assertVariantShape(
  value: unknown,
  entry: IndexVariant,
): asserts value is Variant {
  if (!isRecord(value)) {
    throw new DatasetError(`${entry.file} is not a variant object`);
  }
  const llvm = value.llvm_cfg;
  if (!isRecord(llvm) || !Array.isArray(llvm.nodes) || !Array.isArray(llvm.edges)) {
    throw new DatasetError(`${entry.file} has no usable llvm_cfg`);
  }
  if (value.id !== entry.id) {
    throw new DatasetError(
      `${entry.file} identifies itself as "${String(value.id)}"`,
      `index.json expected "${entry.id}"`,
    );
  }
}

export class Dataset {
  readonly index: DatasetIndex;
  /** Largest value each metric reaches anywhere in the dataset. */
  readonly maxima: VariantMetrics;

  private readonly byConfig = new Map<string, IndexVariant>();
  private readonly cache = new Map<string, Variant>();
  private readonly inflight = new Map<string, Promise<Variant>>();

  constructor(
    index: DatasetIndex,
    private readonly loader: DataLoader,
  ) {
    this.index = index;
    for (const entry of index.variants) {
      this.byConfig.set(configKey(entry.config), entry);
    }
    const maxima = {} as VariantMetrics;
    for (const key of METRIC_KEYS) {
      maxima[key] = index.variants.reduce(
        (max, entry) => Math.max(max, entry.metrics[key]),
        0,
      );
    }
    this.maxima = maxima;
  }

  static async open(loader: DataLoader): Promise<Dataset> {
    const raw = await loader.json("index.json");
    assertIndexShape(raw);
    return new Dataset(raw, loader);
  }

  /** The index entry for a configuration, or a loud failure. */
  lookup(config: VariantConfig): IndexVariant {
    const entry = this.byConfig.get(configKey(config));
    if (!entry) {
      throw new DatasetError(
        "No variant in the dataset matches this configuration",
        configKey(config),
      );
    }
    return entry;
  }

  /** The clean O0 reference variant's index entry. */
  get baseline(): IndexVariant {
    return this.lookup(BASELINE_CONFIG);
  }

  cached(id: string): Variant | undefined {
    return this.cache.get(id);
  }

  /** Fetches a variant once and remembers it. */
  async variant(entry: IndexVariant): Promise<Variant> {
    const hit = this.cache.get(entry.id);
    if (hit) return hit;

    const pending = this.inflight.get(entry.id);
    if (pending) return pending;

    const request = (async () => {
      let raw: unknown;
      try {
        raw = await this.loader.json(entry.file);
      } catch (cause) {
        throw new DatasetError(
          `Could not load ${entry.file}`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      assertVariantShape(raw, entry);
      this.cache.set(entry.id, raw);
      return raw;
    })();

    this.inflight.set(entry.id, request);
    try {
      return await request;
    } finally {
      this.inflight.delete(entry.id);
    }
  }

  source(): Promise<string> {
    return this.loader.text(this.index.source_file);
  }
}
