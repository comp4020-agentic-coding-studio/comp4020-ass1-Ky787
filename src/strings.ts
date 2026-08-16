// Finding the dataset's own watched literals inside the dataset's own symbols.
//
// The compiled objects are MSVC-targeted, so a string literal reaches the
// object as a mangled symbol: "ACCESS GRANTED" is carried by
// `??_C@_0P@ONADOGLL@ACCESS?5GRANTED?$AA@`. Nothing in `web_data/` records
// which symbol holds which literal, so this module answers a narrower question
// than "what does this symbol say".
//
// It never DECODES a symbol. It takes a literal the dataset already lists in
// `watched_plaintext_strings`, re-encodes it the way MSVC encodes literals, and
// asks whether the result appears inside the symbol. That direction matters:
//
//   - A hit is checkable — the escaped literal really is a substring of a
//     symbol the dataset holds, and both halves came out of `web_data/`.
//   - A miss is silent. If the encoding below is wrong or incomplete for some
//     character, the literal simply goes unlabelled and the caller falls back
//     to printing the raw symbol. It can never invent a label for the wrong
//     string, which is the failure that would matter.
//
// `spec/strings.test.ts` holds that to the dataset: across all 256 variants,
// "some symbol matches this literal" must agree with the variant's own
// `watched_plaintext_strings` flag, every time.

/** MSVC spells a nibble as A-P: A is 0, P is 15. */
function nibble(value: number): string {
  return String.fromCharCode(65 + value);
}

/**
 * A literal as it appears inside a mangled symbol name. Identifier characters
 * survive, space has the short form `?5`, and anything else becomes `?$` plus
 * its two nibbles — `=` (0x3D) is `?$DN`, `%` (0x25) is `?$CF`.
 */
export function mangledFragment(literal: string): string {
  return [...literal]
    .map((character) => {
      if (/[A-Za-z0-9_]/.test(character)) return character;
      if (character === " ") return "?5";
      const code = character.charCodeAt(0);
      if (code > 0xff) return character;
      return `?$${nibble(code >> 4)}${nibble(code & 15)}`;
    })
    .join("");
}

/**
 * Which of `watched` appear in `text` — `text` being a mangled symbol name, or
 * a line of LLVM IR that names one. Order follows `watched`, not the text.
 */
export function watchedIn(text: string, watched: readonly string[]): string[] {
  return watched.filter((literal) => text.includes(mangledFragment(literal)));
}
