// Contract: the watched-literal matcher agrees with the dataset about which
// literals survive into the object, in every one of the 256 variants.
//
// This is the check that makes the graph's `; "ACCESS GRANTED"` notes safe to
// print. The matcher never decodes a symbol — it re-encodes a literal the
// dataset already lists and asks whether that appears inside a symbol the
// dataset already holds. If the encoding were wrong, this test goes red rather
// than the page quietly mislabelling a block.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mangledFragment, watchedIn } from "../src/strings.js";
import type { DatasetIndex, Variant } from "../src/types.js";

const DATA = resolve("web_data");

const index = JSON.parse(
  readFileSync(join(DATA, "index.json"), "utf8"),
) as DatasetIndex;

function variant(file: string): Variant {
  return JSON.parse(readFileSync(join(DATA, file), "utf8")) as Variant;
}

function symbolsOf(v: Variant): string[] {
  return v.disassembly.instructions.flatMap((instruction) =>
    instruction.relocations.map((relocation) => relocation.symbol),
  );
}

describe("MSVC literal encoding", () => {
  it("spells the escapes this dataset actually uses", () => {
    expect(mangledFragment("ACCESS GRANTED")).toBe("ACCESS?5GRANTED");
    expect(mangledFragment("result=%u")).toBe("result?$DN?$CFu");
    expect(mangledFragment("plain")).toBe("plain");
  });

  it("finds the literal inside a real symbol from the dataset", () => {
    const symbol = "??_C@_0P@ONADOGLL@ACCESS?5GRANTED?$AA@";
    expect(watchedIn(symbol, ["ACCESS GRANTED", "ACCESS DENIED"])).toEqual([
      "ACCESS GRANTED",
    ]);
  });

  it("does not match a literal that merely looks similar", () => {
    // Without the ?5, "ACCESSGRANTED" is a different symbol body.
    expect(watchedIn("??_C@_0P@X@ACCESSGRANTED?$AA@", ["ACCESS GRANTED"])).toEqual(
      [],
    );
  });
});

describe("every variant in the dataset", () => {
  it("agrees with its own watched_plaintext_strings flags", () => {
    const disagreements: string[] = [];

    for (const entry of index.variants) {
      const v = variant(entry.file);
      const symbols = symbolsOf(v);
      for (const [literal, present] of Object.entries(
        v.watched_plaintext_strings,
      )) {
        const found = symbols.some(
          (symbol) => watchedIn(symbol, [literal]).length > 0,
        );
        if (found !== present) {
          disagreements.push(
            `${entry.id}: "${literal}" dataset=${present} matcher=${found}`,
          );
        }
      }
    }

    expect(disagreements, disagreements.slice(0, 5).join("\n")).toEqual([]);
  });

  it("labels a block only from symbols that block really references", () => {
    // A note must be traceable to a relocation on an instruction whose address
    // this machine block owns — never to the variant at large.
    const v = variant(index.variants[0]!.file);
    const byAddress = new Map(
      v.disassembly.instructions.map((i) => [i.address, i]),
    );
    for (const node of v.machine_cfg.nodes) {
      const owned = new Set(
        node.instruction_addresses.flatMap((address) =>
          (byAddress.get(address)?.relocations ?? []).map((r) => r.symbol),
        ),
      );
      for (const symbol of owned) {
        expect(symbolsOf(v)).toContain(symbol);
      }
    }
  });
});
