// Shapes of the pre-generated dataset in web_data/. These mirror the JSON
// exactly; nothing here is computed or assumed about the compiler.

export type OptimizationLevel = "O0" | "O1" | "O2" | "O3";
export type SplitLevel = 0 | 2 | 3 | 4;
export type BooleanTransform =
  | "bcf"
  | "flattening"
  | "substitution"
  | "string_encryption";

export interface VariantConfig {
  optimization: OptimizationLevel;
  bcf: boolean;
  flattening: boolean;
  substitution: boolean;
  string_encryption: boolean;
  split_level: SplitLevel;
}

export interface VariantMetrics {
  instruction_count: number;
  main_byte_size: number;
  machine_basic_block_count: number;
  machine_cfg_edge_count: number;
  llvm_basic_block_count: number;
  llvm_cfg_edge_count: number;
}

export interface IndexVariant {
  id: string;
  source_variant_id: string;
  file: string;
  config: VariantConfig;
  metrics: VariantMetrics;
}

export interface DatasetIndex {
  schema_version: number;
  variant_count: number;
  source_file: string;
  dimensions: {
    optimization_levels: OptimizationLevel[];
    boolean_transformations: string[];
    split_levels: SplitLevel[];
  };
  variants: IndexVariant[];
}

export type LlvmEdgeKind = "true" | "false" | "branch" | "default" | "case";
export type MachineEdgeKind = "branch" | "fallthrough" | "jump";

export interface CfgEdge<Kind extends string> {
  source: number;
  target: number;
  kind: Kind;
}

export interface LlvmNode {
  id: number;
  label: string;
  instructions: string[];
  order: number;
}

export interface LlvmCfg {
  entry_node_id: number;
  nodes: LlvmNode[];
  edges: CfgEdge<LlvmEdgeKind>[];
}

export interface MachineNode {
  id: number;
  start: number;
  end: number;
  instruction_addresses: number[];
  order: number;
}

export interface MachineCfg {
  entry_node_id: number;
  nodes: MachineNode[];
  edges: CfgEdge<MachineEdgeKind>[];
}

export interface RegOperand {
  type: "reg";
  reg: string;
  size: number;
}

export interface ImmOperand {
  type: "imm";
  value: number;
  hex: string;
  size: number;
}

export interface MemOperand {
  type: "mem";
  segment: string | null;
  base: string | null;
  index: string | null;
  scale: number;
  disp: number;
  size: number;
}

export type Operand = RegOperand | ImmOperand | MemOperand;

export interface Relocation {
  offset: number;
  symbol_index: number;
  symbol: string;
  type_value: number;
  type_name: string;
}

export interface Instruction {
  address: number;
  address_hex: string;
  size: number;
  bytes: string;
  mnemonic: string;
  op_str: string;
  operands: Operand[];
  regs_read: string[];
  regs_write: string[];
  groups: string[];
  relocations: Relocation[];
}

export interface Variant {
  schema_version: number;
  id: string;
  source_variant_id: string;
  config: VariantConfig;
  metrics: VariantMetrics;
  watched_plaintext_strings: Record<string, boolean>;
  disassembly: { instructions: Instruction[] };
  machine_cfg: MachineCfg;
  llvm_cfg: LlvmCfg;
}
