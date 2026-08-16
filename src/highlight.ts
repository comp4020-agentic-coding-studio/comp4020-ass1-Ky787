// Syntax colouring for text that comes verbatim out of the dataset.
//
// Every highlighter here is a *classifier*: it splits the original string into
// runs and wraps each run in a span. The concatenation of the output's text is
// always identical to the input, so nothing is rewritten, normalised or
// invented on the way to the screen. Spans are built with textContent rather
// than markup strings, so dataset text can never be parsed as HTML.

export function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function push(target: DocumentFragment, className: string, text: string): void {
  if (text === "") return;
  target.append(className === "" ? text : span(className, text));
}

// ----------------------------------------------------------------------- C ---

const C_KEYWORDS = new Set([
  "auto",
  "break",
  "case",
  "char",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extern",
  "float",
  "for",
  "goto",
  "if",
  "inline",
  "int",
  "long",
  "register",
  "restrict",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "struct",
  "switch",
  "typedef",
  "union",
  "unsigned",
  "void",
  "volatile",
  "while",
  "_Bool",
]);

const C_TOKEN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|^[ \t]*#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b\d+[uUlL]*\b|[A-Za-z_]\w*|[^\sA-Za-z_]/gm;

/** Highlights a whole C translation unit. */
export function highlightC(source: string): DocumentFragment {
  const out = document.createDocumentFragment();
  C_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = C_TOKEN.exec(source)) !== null) {
    push(out, "", source.slice(last, match.index));
    const token = match[0];
    let cls: string;
    if (token.startsWith("//") || token.startsWith("/*")) cls = "t-comment";
    else if (token.trimStart().startsWith("#")) cls = "t-pre";
    else if (token.startsWith('"') || token.startsWith("'")) cls = "t-string";
    else if (/^\d|^0[xX]/.test(token)) cls = "t-num";
    else if (/^[A-Za-z_]/.test(token))
      cls = C_KEYWORDS.has(token) ? "t-key" : "t-plain";
    else cls = "t-punct";
    push(out, cls, token);
    last = match.index + token.length;
  }
  push(out, "", source.slice(last));
  return out;
}
