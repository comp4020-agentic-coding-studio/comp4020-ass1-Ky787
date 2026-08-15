// The build command for the selected configuration.
//
// This is the one module that does not read from web_data/: the dataset records
// the compiled objects, so the command is assembled from the six controls. The
// switch spellings below are the documented Hikari ones, verified against the
// archived official Hikari documentation and the ChandHsu/Hikari-LLVM15 fork
// this dataset was generated with, including the -bcf_prob=100 the experiment
// runs bogus control flow at.
//
// The target triple has its own evidence in the data: every variant's
// relocations are COFF (`REL32`) and its string symbols carry MSVC name
// mangling, which is a Windows x86-64 object.
//
// The seed is deliberately absent. The experiment fixes it at 12345, but
// nothing records which switch carried it, and a plausible-looking spelling for
// a value someone may paste into a shell is worse than none. It is stated as a
// parameter in the technical details panel instead.

import type { VariantConfig } from "./types.js";

export interface CommandPart {
  text: string;
  /** True for the flags the four switches and the split control add. */
  obfuscating: boolean;
}

export const TARGET_TRIPLE = "x86_64-pc-windows-msvc";

/** The probability this experiment runs bogus control flow at. */
export const BCF_PROBABILITY = 100;

const SWITCHES: { key: keyof VariantConfig; flags: string[] }[] = [
  {
    key: "bcf",
    flags: ["-mllvm -enable-bcfobf", `-mllvm -bcf_prob=${BCF_PROBABILITY}`],
  },
  { key: "flattening", flags: ["-mllvm -enable-cffobf"] },
  { key: "substitution", flags: ["-mllvm -enable-subobf"] },
  { key: "string_encryption", flags: ["-mllvm -enable-strcry"] },
];

/** One entry per line of the displayed command. */
export function buildCommand(config: VariantConfig): CommandPart[] {
  const parts: CommandPart[] = [
    { text: "clang", obfuscating: false },
    { text: `-target ${TARGET_TRIPLE}`, obfuscating: false },
    { text: `-${config.optimization}`, obfuscating: false },
    { text: "-c source.c -o main.o", obfuscating: false },
  ];

  for (const { key, flags } of SWITCHES) {
    if (!config[key]) continue;
    for (const flag of flags) parts.push({ text: flag, obfuscating: true });
  }

  if (config.split_level !== 0) {
    parts.push({ text: "-mllvm -enable-splitobf", obfuscating: true });
    parts.push({
      text: `-mllvm -split_num=${config.split_level}`,
      obfuscating: true,
    });
  }

  return parts;
}

/** The same command as one line, for the clipboard. */
export function commandText(config: VariantConfig): string {
  return buildCommand(config)
    .map((part) => part.text)
    .join(" ");
}

/** How many of the parts came from the obfuscation controls. */
export function obfuscatingFlagCount(config: VariantConfig): number {
  return buildCommand(config).filter((part) => part.obfuscating).length;
}
