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

// ---------------------------------------------------------------- LLVM IR ---

const IR_ATTRIBUTES = new Set([
  "align",
  "noundef",
  "nsw",
  "nuw",
  "exact",
  "inbounds",
  "volatile",
  "nonnull",
  "dereferenceable",
  "zeroext",
  "signext",
  "tail",
  "musttail",
  "to",
  "eq",
  "ne",
  "ugt",
  "uge",
  "ult",
  "ule",
  "sgt",
  "sge",
  "slt",
  "sle",
  "true",
  "false",
  "null",
  "undef",
  "poison",
]);

const IR_TYPE = /^(?:i\d+|ptr|void|float|double|half|label|token|x86_fp80)$/;

const IR_TOKEN =
  /%[\w.$-]+|@"(?:[^"\\]|\\.)*"|@[\w.$-]+|!\w+|"(?:[^"\\]|\\.)*"|\b0x[0-9a-fA-F]+\b|-?\b\d+\b|[A-Za-z_][\w.]*|\s+|[^\s]/g;

function classifyIrToken(token: string): string {
  if (token.startsWith("%")) return "t-local";
  if (token.startsWith("@")) return "t-global";
  if (token.startsWith("!")) return "t-meta";
  if (token.startsWith('"')) return "t-string";
  if (/^-?\d/.test(token) || token.startsWith("0x")) return "t-num";
  if (/^[A-Za-z_]/.test(token)) {
    if (IR_TYPE.test(token)) return "t-type";
    if (IR_ATTRIBUTES.has(token)) return "t-attr";
    return "t-plain";
  }
  if (/^\s+$/.test(token)) return "";
  return "t-punct";
}

/**
 * Highlights one line of LLVM IR. The opcode is taken positionally — the first
 * word after any `%result =` — rather than matched against a hand-written list
 * of instructions, so unfamiliar opcodes still read correctly.
 */
export function highlightIr(line: string): DocumentFragment {
  const out = document.createDocumentFragment();

  const head = /^(\s*)(?:(%[\w.$-]+)(\s*=\s*))?([A-Za-z_][\w.]*)?/.exec(line);
  let cursor = 0;
  if (head) {
    const [matched, indent, result, equals, opcode] = head;
    push(out, "", indent ?? "");
    if (result) {
      push(out, "t-local", result);
      push(out, "t-punct", equals ?? "");
    }
    if (opcode) push(out, "t-op", opcode);
    cursor = matched.length;
  }

  const rest = line.slice(cursor);
  IR_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = IR_TOKEN.exec(rest)) !== null) {
    push(out, "", rest.slice(last, match.index));
    push(out, classifyIrToken(match[0]), match[0]);
    last = match.index + match[0].length;
  }
  push(out, "", rest.slice(last));
  return out;
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
