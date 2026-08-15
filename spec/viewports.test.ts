// Contract: the deployed site actually works at the two viewports it is marked
// at — including the parts jsdom cannot see, which is layout.
//
// This drives the real built site in a real Chromium over a real static server.
// If no system browser can be launched (a bare CI image, say), the suite skips
// rather than failing: it is a layout sensor, not a build dependency.
//
// Assertions are vitest's, not Playwright's: playwright-core ships the browser
// driver without @playwright/test's web-first matchers, so every wait here is
// an explicit waitForFunction.

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DIST = resolve("dist");
const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 390, height: 844 };
const CLEAN = "o0-bcf0-fla0-sub0-str0-split0";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".c": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveDist(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
    response.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      done({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((path): path is string => Boolean(path));

async function tryLaunch(): Promise<Browser | null> {
  for (const executablePath of CANDIDATES) {
    if (!existsSync(executablePath)) continue;
    try {
      return await chromium.launch({
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const browser = await tryLaunch();
const served = browser ? await serveDist() : null;

if (!browser) {
  console.warn(
    "[viewports] no launchable system Chromium found — layout checks skipped",
  );
}

afterAll(async () => {
  await browser?.close();
  served?.server.close();
});

const withBrowser = browser && served ? describe : describe.skip;

interface Session {
  page: Page;
  errors: string[];
  requests: string[];
  close(): Promise<void>;
}

async function open(viewport: {
  width: number;
  height: number;
}): Promise<Session> {
  const context = await browser!.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${served!.origin}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="graph-counts"]')
        ?.hasAttribute("data-blocks") === true,
    undefined,
    { timeout: 20_000 },
  );
  return { page, errors, requests, close: () => context.close() };
}

// ------------------------------------------------------------- utilities ---

const text = async (page: Page, selector: string): Promise<string> =>
  (await page.textContent(selector))?.trim() ?? "";

const variantId = (page: Page): Promise<string> =>
  text(page, '[data-testid="variant-id"]');

const overflow = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

const visible = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).isVisible();

/** Waits for the app to land on a variant other than `previous`, fully loaded. */
async function waitForSwap(page: Page, previous: string): Promise<void> {
  await page.waitForFunction(
    (prev) => {
      const id = document
        .querySelector('[data-testid="variant-id"]')
        ?.textContent?.trim();
      const overlayHidden =
        document.querySelector("[data-role='overlay']")?.hasAttribute("hidden") ??
        false;
      return Boolean(id) && id !== prev && overlayHidden;
    },
    previous,
    { timeout: 25_000 },
  );
}

async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-role='overlay']")?.hasAttribute("hidden") ===
      true,
    undefined,
    { timeout: 25_000 },
  );
}

/** Clicks the visible switch row, the way a person does — the input is styled. */
async function setSwitch(page: Page, key: string, on: boolean): Promise<void> {
  const input = page.locator(`[data-transform="${key}"]`);
  if ((await input.isChecked()) === on) return;
  const before = await variantId(page);
  await page.locator(`.switch:has([data-transform="${key}"])`).click();
  await waitForSwap(page, before);
}

async function pickRadio(
  page: Page,
  group: "opt" | "split",
  value: string,
): Promise<void> {
  const input = page.locator(`input[name="${group}"][value="${value}"]`);
  if (await input.isChecked()) return;
  const before = await variantId(page);
  await page
    .locator(`.segmented__opt:has(input[name="${group}"][value="${value}"])`)
    .click();
  await waitForSwap(page, before);
}

async function resetAll(page: Page): Promise<void> {
  await page.locator('[data-testid="reset"]').click();
  await waitForIdle(page);
  await page.waitForFunction(
    (clean) =>
      document.querySelector('[data-testid="variant-id"]')?.textContent?.trim() ===
      clean,
    CLEAN,
    { timeout: 25_000 },
  );
}

// -------------------------------------------------------------- desktop ---

withBrowser("desktop 1920x1080", () => {
  let session: Session;

  beforeAll(async () => {
    session = await open(DESKTOP);
  }, 90_000);

  afterAll(async () => {
    await session?.close();
  });

  it("opens on the clean O0 variant", async () => {
    expect(await variantId(session.page)).toBe(CLEAN);
    expect(await text(session.page, '[data-testid="graph-counts"]')).toBe(
      "7 blocks · 8 edges",
    );
  });

  it("draws the graph on a canvas that fills the stage", async () => {
    const box = await session.page
      .locator('[data-testid="graph"] canvas')
      .first()
      .boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(600);
    expect(box?.height ?? 0).toBeGreaterThan(320);
  });

  it("does not scroll sideways", async () => {
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
  });

  it("loads only the variant it needs", async () => {
    expect(
      session.requests.filter((url) => url.includes("/web_data/variants/")),
    ).toHaveLength(1);
    expect(
      session.requests.filter((url) => url.includes("/web_data/index.json")),
    ).toHaveLength(1);
  });

  it("swaps variants without reloading the page", async () => {
    await session.page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__sentinel = "alive";
    });
    await setSwitch(session.page, "bcf", true);
    expect(await variantId(session.page)).toBe("o0-bcf1-fla0-sub0-str0-split0");
    expect(
      await session.page.evaluate(
        () => (window as unknown as Record<string, unknown>).__sentinel,
      ),
    ).toBe("alive");
  }, 40_000);

  it("grows the graph and the metrics together", async () => {
    const blocks = Number(
      await session.page.getAttribute(
        '[data-testid="graph-counts"]',
        "data-blocks",
      ),
    );
    expect(blocks).toBeGreaterThan(7);
    expect(await text(session.page, '[data-testid="graph-counts"]')).toContain(
      `${blocks} blocks`,
    );

    const number = async (role: string): Promise<number> =>
      Number(
        (
          await text(
            session.page,
            `[data-metric="instructions"] [data-role="${role}"]`,
          )
        ).replace(/[^\d]/g, ""),
      );
    expect(await number("current")).toBeGreaterThan(await number("base"));
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
  });

  it("re-serves a cached variant without another request", async () => {
    const before = session.requests.filter((url) =>
      url.includes("/web_data/variants/"),
    ).length;
    await setSwitch(session.page, "bcf", false);
    await setSwitch(session.page, "bcf", true);
    expect(
      session.requests.filter((url) => url.includes("/web_data/variants/")),
    ).toHaveLength(before);
  }, 40_000);

  it("opens the inspector from the keyboard", async () => {
    await session.page.locator('[data-testid="graph"]').focus();
    await session.page.keyboard.press("ArrowDown");
    expect(
      await visible(session.page, '[data-testid="inspector"] [data-role="body"]'),
    ).toBe(true);
    expect((await text(session.page, '[data-testid="ir"]')).length).toBeGreaterThan(
      10,
    );
    expect(
      (await text(session.page, '[data-testid="graph-status"]')).length,
    ).toBeGreaterThan(0);
  });

  it("reaches every control by tabbing", async () => {
    await session.page.locator(".skip-link").focus();
    const reached = new Set<string>();
    for (let i = 0; i < 26; i += 1) {
      await session.page.keyboard.press("Tab");
      const id = await session.page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return "";
        if (active.dataset.transform) return active.dataset.transform;
        const name = active.getAttribute("name");
        if (name) return `${name}:${(active as HTMLInputElement).value}`;
        return "";
      });
      if (id) reached.add(id);
    }
    for (const key of ["bcf", "flattening", "substitution", "string_encryption"]) {
      expect(reached.has(key), `never focused ${key}`).toBe(true);
    }
    expect([...reached].some((id) => id.startsWith("split:"))).toBe(true);
    expect([...reached].some((id) => id.startsWith("opt:"))).toBe(true);
  }, 40_000);

  it("shows a visible focus ring on the switches", async () => {
    await session.page.locator('[data-transform="bcf"]').focus();
    const outlined = await session.page.evaluate(() => {
      const row = document.querySelector(".switch:has([data-transform='bcf'])");
      if (!row) return false;
      const style = getComputedStyle(row);
      return (
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1
      );
    });
    expect(outlined).toBe(true);
  });

  it("resets to the clean variant", async () => {
    await resetAll(session.page);
    expect(await variantId(session.page)).toBe(CLEAN);
    expect(
      await session.page.locator('[data-transform="bcf"]').isChecked(),
    ).toBe(false);
    expect(await text(session.page, '[data-testid="graph-counts"]')).toBe(
      "7 blocks · 8 edges",
    );
  }, 40_000);

  it("shows the source and the assembly side by side", async () => {
    const source = await session.page.locator('[data-testid="source"]').boundingBox();
    const asm = await session.page.locator('[data-testid="asm-full"]').boundingBox();
    expect(source).not.toBeNull();
    expect(asm).not.toBeNull();
    // Same row, different columns.
    expect(Math.abs((source!.y ?? 0) - (asm!.y ?? 0))).toBeLessThan(8);
    expect(asm!.x).toBeGreaterThan(source!.x + source!.width - 8);
    expect((await text(session.page, '[data-testid="source"]')).length)
      .toBeGreaterThan(100);
  });

  it("gives the graph the lower viewport once scrolled to it", async () => {
    await session.page.locator('[data-testid="fit"]').scrollIntoViewIfNeeded();
    await session.page.waitForTimeout(250);
    const stage = await session.page.locator(".graph-stage").boundingBox();
    expect(stage?.height ?? 0).toBeGreaterThan(500);
    const canvas = await session.page
      .locator('[data-testid="graph"] canvas')
      .first()
      .boundingBox();
    expect(canvas?.height ?? 0).toBeGreaterThan(500);
  });

  it("keeps the controls pinned while the graph is on screen", async () => {
    await session.page.evaluate(() =>
      document.querySelector("#cfg")?.scrollIntoView({ block: "start" }),
    );
    await session.page.waitForTimeout(250);
    expect(
      await session.page.evaluate(() => window.scrollY),
      "the page should have scrolled to the graph",
    ).toBeGreaterThan(200);

    const dock = await session.page.locator('[data-testid="dock"]').boundingBox();
    expect(dock).not.toBeNull();
    expect(dock!.y, "controls should be pinned to the top").toBeLessThan(24);
    expect(
      await session.page.locator('[data-transform="bcf"]').isVisible(),
    ).toBe(true);

    // The pinned bar must not be sitting on top of the graph's own toolbar.
    const tools = await session.page.locator(".graph-tools").boundingBox();
    expect(tools!.y).toBeGreaterThanOrEqual(dock!.y + dock!.height - 12);
  });

  it("shows the build command and updates it with the controls", async () => {
    await resetAll(session.page);
    expect(await text(session.page, '[data-testid="cli"]')).toContain(
      "# no obfuscation passes enabled",
    );
    await setSwitch(session.page, "flattening", true);
    await pickRadio(session.page, "split", "3");
    const cli = await text(session.page, '[data-testid="cli"]');
    expect(cli).toContain("-mllvm -enable-cffobf");
    expect(cli).toContain("-mllvm -split_num=3");
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
    await resetAll(session.page);
  }, 60_000);

  it("logs nothing to the console error channel", () => {
    expect(session.errors, session.errors.join(" | ")).toEqual([]);
  });
});

// --------------------------------------------------------------- mobile ---

withBrowser("mobile 390x844", () => {
  let session: Session;

  beforeAll(async () => {
    session = await open(MOBILE);
  }, 90_000);

  afterAll(async () => {
    await session?.close();
  });

  it("never scrolls sideways, clean or obfuscated", async () => {
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
    for (const key of ["bcf", "flattening", "substitution", "string_encryption"]) {
      await setSwitch(session.page, key, true);
      expect(await overflow(session.page), key).toBeLessThanOrEqual(0);
    }
    await pickRadio(session.page, "split", "4");
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
    await resetAll(session.page);
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
  }, 120_000);

  it("keeps the graph big enough to read", async () => {
    const box = await session.page.locator(".graph-stage").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(330);
    expect(box?.width ?? 0).toBeLessThanOrEqual(MOBILE.width);
  });

  it("stacks the two code panes instead of squeezing them", async () => {
    const source = await session.page.locator('[data-testid="source"]').boundingBox();
    const asm = await session.page.locator('[data-testid="asm-full"]').boundingBox();
    expect(asm!.y).toBeGreaterThan(source!.y + source!.height - 8);
    expect(source!.width).toBeLessThanOrEqual(MOBILE.width);
    expect(asm!.width).toBeLessThanOrEqual(MOBILE.width);
  });

  it("does not pin the controls over a small screen", async () => {
    const before = await session.page
      .locator('[data-testid="dock"]')
      .boundingBox();
    await session.page.locator('[data-testid="fit"]').scrollIntoViewIfNeeded();
    await session.page.waitForTimeout(200);
    const after = await session.page
      .locator('[data-testid="dock"]')
      .boundingBox();
    // Static, so scrolling moves it off screen rather than parking it on top.
    expect(after!.y).toBeLessThan(before!.y);
  });

  it("hides the inspector until a block is chosen, then shows it as a sheet", async () => {
    expect(await visible(session.page, '[data-testid="inspector"]')).toBe(false);

    await session.page.locator('[data-testid="graph"]').focus();
    await session.page.keyboard.press("ArrowDown");
    await session.page.keyboard.press("Enter");
    await session.page.waitForTimeout(320);
    expect(await visible(session.page, '[data-testid="inspector"]')).toBe(true);
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);

    await session.page.locator('[data-testid="inspector-close"]').click();
    await session.page.waitForTimeout(320);
    expect(await visible(session.page, '[data-testid="inspector"]')).toBe(false);
  }, 40_000);

  it("scrolls a long assembly listing inside its own box", async () => {
    await session.page.locator('[data-testid="graph"]').focus();
    await session.page.keyboard.press("ArrowDown");
    await session.page.keyboard.press("Enter");
    await session.page.waitForTimeout(320);
    await session.page.locator('[data-testid="tab-asm"]').click();

    const fits = await session.page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>('[data-testid="asm"]');
      if (!pre) return false;
      return (
        pre.getBoundingClientRect().width <= window.innerWidth &&
        getComputedStyle(pre).overflowX !== "visible"
      );
    });
    expect(fits).toBe(true);
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);

    await session.page.locator('[data-testid="inspector-close"]').click();
    await session.page.waitForTimeout(320);
  }, 40_000);

  it("keeps the configuration when the viewport is resized mid-interaction", async () => {
    await setSwitch(session.page, "flattening", true);
    await pickRadio(session.page, "opt", "O2");
    const before = await variantId(session.page);
    const counts = await text(session.page, '[data-testid="graph-counts"]');

    await session.page.setViewportSize(DESKTOP);
    await session.page.waitForTimeout(300);
    expect(await variantId(session.page)).toBe(before);
    expect(await text(session.page, '[data-testid="graph-counts"]')).toBe(counts);
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);

    await session.page.setViewportSize(MOBILE);
    await session.page.waitForTimeout(300);
    expect(await variantId(session.page)).toBe(before);
    expect(
      await session.page.locator('[data-transform="flattening"]').isChecked(),
    ).toBe(true);
    expect(
      await session.page.locator('input[name="opt"][value="O2"]').isChecked(),
    ).toBe(true);
    expect(await overflow(session.page)).toBeLessThanOrEqual(0);
  }, 90_000);

  it("logs nothing to the console error channel", () => {
    expect(session.errors, session.errors.join(" | ")).toEqual([]);
  });
});
