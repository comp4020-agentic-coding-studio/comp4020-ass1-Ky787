// Rendering of the machine code that Capstone already produced.
//
// The instruction text on screen is Capstone's own `mnemonic` and `op_str`,
// character for character. The structured `operands` array is used only to
// decide what colour each run of that text gets. Nothing is re-assembled,
// reformatted or reconstructed here: if the structured operands cannot be
// lined up with the text, the operands are drawn unstyled rather than guessed.

import { span } from "./highlight.js";
import type { Instruction, Operand, Variant } from "./types.js";

const SIZE_WORDS = new Set([
  "byte",
  "word",
  "dword",
  "qword",
  "tbyte",
  "xmmword",
  "ymmword",
  "zmmword",
  "ptr",
]);

export interface OperandRange {
  start: number;
  end: number;
}

/**
 * Locates each operand inside an `op_str`, cutting only at commas that sit
 * outside a memory expression's brackets.
 *
 * Ranges rather than substrings: the caller re-emits the separators between
 * them from the original string, so the rendered text is byte-identical to what
 * Capstone printed.
 */
export function operandRanges(opStr: string): OperandRange[] {
  if (opStr.trim() === "") return [];
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < opStr.length; i += 1) {
    const ch = opStr[i];
    if (ch === "[" || ch === "(") depth += 1;
    else if (ch === "]" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) cuts.push(i);
  }
  const bounds = [0, ...cuts.map((i) => i + 1)];
  return bounds.map((from, i) => {
    const to = i < cuts.length ? cuts[i]! : opStr.length;
    let start = from;
    let end = to;
    while (start < end && /\s/.test(opStr[start]!)) start += 1;
    while (end > start && /\s/.test(opStr[end - 1]!)) end -= 1;
    return { start, end };
  });
}

/** The operand substrings, for reading and for tests. */
export function splitOperandText(opStr: string): string[] {
  return operandRanges(opStr).map(({ start, end }) => opStr.slice(start, end));
}

const MEM_TOKEN = /[A-Za-z_]\w*|0x[0-9a-fA-F]+|\d+|\s+|[^\s\w]/g;

function renderMemOperand(text: string, operand: Operand): DocumentFragment {
  const out = document.createDocumentFragment();
  const registers = new Set<string>();
  if (operand.type === "mem") {
    for (const reg of [operand.base, operand.index, operand.segment]) {
      if (reg) registers.add(reg.toLowerCase());
    }
  }
  MEM_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = MEM_TOKEN.exec(text)) !== null) {
    if (match.index > last) out.append(text.slice(last, match.index));
    const token = match[0];
    const lower = token.toLowerCase();
    if (/^\s+$/.test(token)) out.append(token);
    else if (registers.has(lower)) out.append(span("asm-reg", token));
    else if (SIZE_WORDS.has(lower)) out.append(span("asm-size", token));
    else if (/^\d|^0x/i.test(token)) out.append(span("asm-disp", token));
    else if (/^[A-Za-z_]/.test(token)) out.append(span("asm-plain", token));
    else out.append(span("asm-punct", token));
    last = match.index + token.length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

function renderOperand(text: string, operand: Operand): Node {
  switch (operand.type) {
    case "reg":
      return span("asm-reg", text);
    case "imm":
      return span("asm-imm", text);
    case "mem": {
      const wrapper = document.createElement("span");
      wrapper.className = "asm-mem";
      wrapper.append(renderMemOperand(text, operand));
      return wrapper;
    }
  }
}

/** One `<span class="asm-line">` per instruction, ready to drop into a `<pre>`. */
export function renderInstruction(instruction: Instruction): HTMLElement {
  const line = document.createElement("span");
  line.className = "asm-line";

  line.append(span("asm-addr", instruction.address_hex));

  const flow =
    instruction.groups.includes("jump") ||
    instruction.groups.includes("call") ||
    instruction.groups.includes("ret");
  line.append(span(flow ? "asm-mn asm-mn--flow" : "asm-mn", instruction.mnemonic));

  const opStr = instruction.op_str;
  const ranges = operandRanges(opStr);
  const ops = document.createElement("span");
  ops.className = "asm-ops";
  if (ranges.length > 0 && ranges.length === instruction.operands.length) {
    // Index-aligned by the length check above: Capstone prints operands in the
    // order it lists them. Separators come from the original string.
    let cursor = 0;
    ranges.forEach((range, i) => {
      if (range.start > cursor) {
        ops.append(span("asm-punct", opStr.slice(cursor, range.start)));
      }
      const operand = instruction.operands[i] as Operand;
      ops.append(renderOperand(opStr.slice(range.start, range.end), operand));
      cursor = range.end;
    });
    if (cursor < opStr.length) ops.append(span("asm-punct", opStr.slice(cursor)));
  } else if (opStr !== "") {
    // Structured operands did not line up with the printed text, so make no
    // claim about what each run is — print it as Capstone gave it.
    ops.append(span("asm-plain", opStr));
  }
  line.append(ops);

  if (instruction.relocations.length > 0) {
    const symbols = instruction.relocations.map((r) => r.symbol).join(", ");
    line.append(span("asm-reloc", `; ${symbols}`));
  }

  return line;
}

/** Address → instruction, for resolving a machine block's address list. */
export function instructionsByAddress(
  variant: Variant,
): Map<number, Instruction> {
  const map = new Map<number, Instruction>();
  for (const instruction of variant.disassembly.instructions) {
    map.set(instruction.address, instruction);
  }
  return map;
}
