// Plain-English help, for a reader who has never opened a disassembler.
//
// These are explanations of general compiler ideas, not claims about the
// dataset — every number on the page still comes from web_data/. Each one is
// two sentences at most, and says what the thing *is* before what it is called.
//
// A hint opens on hover, on keyboard focus and on click, because a phone has no
// hover and a keyboard has no pointer. Escape closes it.

export interface Hint {
  /** Names the thing being explained; becomes the button's accessible name. */
  title: string;
  body: string;
}

export const HINTS: Record<string, Hint> = {
  transformations: {
    title: "Transformations",
    body: "Each switch asks the compiler to rewrite the program so it is harder to read, without changing what it does. Turn them on and the output grows; the behaviour stays identical.",
  },
  bcf: {
    title: "Bogus Control Flow",
    body: "Adds fake branches and dead code that can never actually run. A reader has to work out which paths are real; the program never takes the fake ones.",
  },
  flattening: {
    title: "Control Flow Flattening",
    body: "Throws away the shape of the program — the ifs and elses — and replaces it with one big switch that jumps between numbered chunks. The order still happens, but you can no longer see it by looking.",
  },
  substitution: {
    title: "Instruction Substitution",
    body: "Swaps simple arithmetic for long-winded equivalents, so 'add 3' might become several operations that work out to the same thing. Same answer, more to read.",
  },
  string_encryption: {
    title: "String Encryption",
    body: "Scrambles the readable text inside the program and unscrambles it only while running. Searching the file for words like ACCESS GRANTED stops finding them.",
  },
  split: {
    title: "Basic Block Splitting",
    body: "Chops each straight run of code into 2, 3 or 4 smaller pieces. Nothing is added, but the graph gains a lot more boxes.",
  },
  optimization: {
    title: "Compiler Optimization",
    body: "How hard the compiler works to make the program fast and small, from O0 (none) to O3 (most). It is the normal setting every program is built with — not an obfuscation.",
  },
  command: {
    title: "Build command",
    body: "The command line that produces the version you are looking at. Everything in orange is a switch your toggles above added.",
  },
  source: {
    title: "The source code",
    body: "The C program a person actually wrote. This is the input to every one of the 256 builds and it never changes, no matter what you switch on.",
  },
  disassembly: {
    title: "The machine code",
    body: "What the program actually becomes: the individual steps the processor runs. This is what someone trying to understand the program without the source has to read.",
  },
  instructions: {
    title: "Instructions",
    body: "How many individual steps the processor has to run. More steps means more for a human to read through.",
  },
  blocks: {
    title: "Basic blocks",
    body: "A block is a straight run of code with no branching in the middle. They are the boxes in the graph below.",
  },
  edges: {
    title: "Edges",
    body: "An arrow from one block to another — a place the program can jump. More arrows means more paths to keep track of.",
  },
  bytes: {
    title: "Size of main",
    body: "How many bytes the compiled function takes up. The program does the same thing either way; it just gets bigger.",
  },
  strings: {
    title: "Plaintext strings",
    body: "How many of the readable messages can still be found by searching the compiled file. Fewer means the text has been hidden.",
  },
  graph: {
    title: "Control-flow graph",
    body: "A map of the program: each box is a chunk of code, each arrow a jump it can make. This is the first thing an analyst draws, and obfuscation is aimed squarely at it.",
  },
};

const OPEN = "data-open";

function place(bubble: HTMLElement, wrapper: HTMLElement): void {
  // Flip to the right edge if the bubble would run off the page — an
  // absolutely positioned element that overhangs would scroll the whole page.
  wrapper.classList.remove("hint--flip");
  const view = bubble.ownerDocument.defaultView;
  if (!view) return;
  const box = bubble.getBoundingClientRect();
  if (box.right > view.innerWidth - 8) wrapper.classList.add("hint--flip");
}

/**
 * Replaces every `<span data-hint="key">` placeholder with a question-mark
 * button and its explanation.
 */
export function mountHints(doc: Document): () => void {
  const teardown: (() => void)[] = [];
  let counter = 0;

  for (const slot of doc.querySelectorAll<HTMLElement>("[data-hint]")) {
    const hint = HINTS[slot.dataset.hint ?? ""];
    if (!hint) continue;
    counter += 1;
    const id = `hint-${counter}`;

    const wrapper = doc.createElement("span");
    wrapper.className = "hint";
    wrapper.setAttribute(OPEN, "false");

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "hint__btn";
    button.textContent = "?";
    button.setAttribute("aria-label", `What is ${hint.title}?`);
    button.setAttribute("aria-describedby", id);
    button.setAttribute("aria-expanded", "false");

    const bubble = doc.createElement("span");
    bubble.className = "hint__bubble";
    bubble.id = id;
    bubble.setAttribute("role", "tooltip");
    const strong = doc.createElement("strong");
    strong.textContent = hint.title;
    bubble.append(strong, doc.createTextNode(hint.body));

    wrapper.append(button, bubble);
    slot.replaceWith(wrapper);

    // Three independent reasons to be open, tracked separately: a pointer over
    // it, keyboard focus on it, or a click that pinned it. Collapsing these
    // into one toggle makes hovering-then-clicking close the bubble, which is
    // exactly what a mouse user does.
    let hovering = false;
    let focused = false;
    let pinned = false;
    const sync = (): void => {
      const open = hovering || focused || pinned;
      wrapper.setAttribute(OPEN, String(open));
      button.setAttribute("aria-expanded", String(open));
      if (open) place(bubble, wrapper);
    };

    const on = (
      target: EventTarget,
      type: string,
      handler: (event: Event) => void,
    ): void => {
      target.addEventListener(type, handler);
      teardown.push(() => target.removeEventListener(type, handler));
    };

    on(button, "click", (event) => {
      // Several hints live inside a <label>, where a bare click would activate
      // the label and flip the switch the reader was asking about.
      event.preventDefault();
      event.stopPropagation();
      pinned = !pinned;
      sync();
    });
    on(button, "focus", () => {
      focused = true;
      sync();
    });
    on(button, "blur", () => {
      focused = false;
      pinned = false;
      sync();
    });
    on(wrapper, "mouseenter", () => {
      hovering = true;
      sync();
    });
    on(wrapper, "mouseleave", () => {
      hovering = false;
      sync();
    });
    on(button, "keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      pinned = false;
      focused = false;
      sync();
      button.blur();
    });
  }

  return () => {
    for (const off of teardown) off();
  };
}
