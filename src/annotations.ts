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

/**
 * A short overview of the program, shown above the code. Like the line notes,
 * this is written by this page: the compiled file carries no comments.
 */
export const OVERVIEW: string[] = [
  "This program looks at how many words you typed after its name,",
  "turns that into a number, prints one of two messages depending",
  "on whether the number is even, then prints the final value.",
  "That is all it does — in every one of the 256 builds.",
];

export const ANNOTATIONS: Annotation[] = [
  {
    match: "int main(",
    note: "the program starts here",
  },
  {
    match: "unsigned x =",
    note: "make a number out of the input",
  },
  {
    match: "if ((x & 1u) == 0)",
    note: "is it even?",
  },
  {
    match: 'puts("ACCESS GRANTED")',
    note: "yes: print this",
  },
  {
    match: 'puts("ACCESS DENIED")',
    note: "no: print this",
  },
  {
    match: "printf(",
    note: "print the answer",
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
