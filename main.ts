// Browser entry point. Everything factual on the page is read from web_data/
// at runtime: index.json first, then exactly one variant file at a time.

import { createApp } from "./src/app.js";
import { Dataset, DatasetError, type DataLoader } from "./src/dataset.js";
import { createGraphView } from "./src/graph.js";

const DATA_BASE = "web_data/";

function dataUrl(relativePath: string): string {
  return new URL(DATA_BASE + relativePath, document.baseURI).href;
}

async function request(relativePath: string): Promise<Response> {
  const response = await fetch(dataUrl(relativePath));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${DATA_BASE}${relativePath}`);
  }
  return response;
}

const loader: DataLoader = {
  async json(relativePath) {
    return (await request(relativePath)).json();
  },
  async text(relativePath) {
    return (await request(relativePath)).text();
  },
};

function fatal(error: unknown): void {
  const overlay = document.querySelector<HTMLElement>("[data-role='overlay']");
  const message =
    error instanceof Error ? error.message : String(error);
  const detail = error instanceof DatasetError ? error.detail : "";
  if (!overlay) return;
  overlay.hidden = false;
  overlay.setAttribute("data-kind", "error");
  overlay.replaceChildren();
  const box = document.createElement("div");
  box.className = "overlay__error";
  for (const [cls, text] of [
    ["overlay__title", "The dataset could not be loaded"],
    ["overlay__text", message],
    ["overlay__detail", detail],
  ] as const) {
    if (!text) continue;
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    box.append(el);
  }
  overlay.append(box);
}

async function boot(): Promise<void> {
  try {
    const dataset = await Dataset.open(loader);
    await createApp({
      doc: document,
      dataset,
      makeGraph: createGraphView,
    });
  } catch (error) {
    fatal(error);
  }
}

void boot();
