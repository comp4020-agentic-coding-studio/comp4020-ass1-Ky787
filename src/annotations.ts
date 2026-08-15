// Plain-English notes for source.c.
//
// The compiled file has no comments. These are written by this page and shown
// beside the code, never merged into it: `annotate` returns the source line
// untouched and the note separately, so what is rendered as code is still the
// exact bytes that produced all 256 variants.
//
// Notes are matched on a snippet of the line rather than a line number, so a
// whitespace change in the dataset cannot silently move a note onto the wrong
// statement. A snippet that matches nothing is reported instead of ignored.

export interface AnnotatedLine {
  /** The source line, verbatim. */
  code: string;
  /** The note for this line, if it has one. */
  note?: string;
}

interface Annotation {
  match: string;
  note: string;
}

export const ANNOTATIONS: Annotation[] = [
  {
    match: "extern int puts",
    note: "borrow the system's print-a-line function",
  },
  {
    match: "extern int printf",
    note: "and its fill-in-the-blanks version",
  },
  {
    match: "int main(",
    note: "the program starts here; argc counts the words you typed after its name",
  },
  {
    match: "unsigned x =",
    note: "turn that count into a number: times 7, plus 3",
  },
  {
    match: "if ((x & 1u) == 0)",
    note: "is that number even?",
  },
  {
    match: 'puts("ACCESS GRANTED")',
    note: "if it is, say so",
  },
  {
    match: "x = (x * 3u)",
    note: "then scramble the number one way",
  },
  {
    match: 'puts("ACCESS DENIED")',
    note: "if it is odd, say this instead",
  },
  {
    match: "x = (x + 13u)",
    note: "and scramble it a different way",
  },
  {
    match: "if (x > 100u)",
    note: "is the result over 100?",
  },
  {
    match: "x -= 17u",
    note: "if so, take 17 off",
  },
  {
    match: "x += 5u",
    note: "if not, add 5",
  },
  {
    match: "printf(",
    note: "print the last two hex digits of the answer",
  },
  {
    match: "return 0",
    note: "0 means it finished without an error",
  },
];

export interface AnnotatedSource {
  lines: AnnotatedLine[];
  /** Snippets that matched no line — a drifted dataset, not a silent no-op. */
  unmatched: string[];
}

/** Splits the source into lines and attaches each note to its first match. */
export function annotate(source: string): AnnotatedSource {
  const lines = source.replace(/\n+$/, "").split("\n");
  const notes = new Map<number, string>();
  const unmatched: string[] = [];

  for (const { match, note } of ANNOTATIONS) {
    const index = lines.findIndex(
      (line, i) => !notes.has(i) && line.includes(match),
    );
    if (index === -1) unmatched.push(match);
    else notes.set(index, note);
  }

  return {
    lines: lines.map((code, i) => {
      const note = notes.get(i);
      return note === undefined ? { code } : { code, note };
    }),
    unmatched,
  };
}
