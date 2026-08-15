// The build command, reconstructed from the selected configuration.
//
// IMPORTANT: this is the one thing on the page that is NOT read out of
// web_data/. The dataset records the compiled objects; it does not record the
// command that produced them. What follows is the documented Hikari switch for
// each transformation the dataset's configuration names, assembled in the order
// the controls present them — an illustration of what would produce a build
// like this, and labelled as such wherever it is shown.
//
// The target triple is the one piece here with evidence behind it: every
// variant's relocations are COFF (`REL32`) and its string symbols carry MSVC
// name mangling, which is a Windows x86-64 object.
//
// The seed is deliberately absent. The brief fixes it at 12345, but nothing in
// the dataset records which switch carried it, and inventing a plausible
// spelling for a value someone might paste into a shell is worse than leaving
// it to the technical details panel, where it is stated as a parameter rather
// than as a flag.

import type { VariantConfig } from "./types.js";

export interface CommandPart {
  text: string;
  /** True for the flags the four switches and the split control add. */
  obfuscating: boolean;
}

export const TARGET_TRIPLE = "x86_64-pc-windows-msvc";

const SWITCHES: { key: keyof VariantConfig; flag: string }[] = [
  { key: "bcf", flag: "-mllvm -enable-bcfobf" },
  { key: "flattening", flag: "-mllvm -enable-cffobf" },
  { key: "substitution", flag: "-mllvm -enable-subobf" },
  { key: "string_encryption", flag: "-mllvm -enable-strcry" },
];

/** One entry per line of the displayed command. */
export function buildCommand(config: VariantConfig): CommandPart[] {
  const parts: CommandPart[] = [
    { text: "clang", obfuscating: false },
    { text: `-target ${TARGET_TRIPLE}`, obfuscating: false },
    { text: `-${config.optimization}`, obfuscating: false },
    { text: "-c source.c -o main.o", obfuscating: false },
  ];

  for (const { key, flag } of SWITCHES) {
    if (config[key]) parts.push({ text: flag, obfuscating: true });
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
