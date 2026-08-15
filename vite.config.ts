import { cpSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Every .html file in the repo is a page and a build entry, so a multi-page
// hand-written site needs no build config: add pages, link them, ship.
// (Vite's default would build only the root index.html and silently drop the
// rest from dist/ — fine locally, 404s deployed.)
const SKIP = new Set([
  "node_modules",
  "dist",
  "spec",
  "scripts",
  "reflections",
  "web_data",
]);

function htmlEntries(dir = "."): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlEntries(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

// The dataset stays at web_data/ — the path the assignment publishes and the
// path the page fetches from — rather than moving into public/. The dev server
// already serves it from the project root; this copies it into the build so the
// deployed site fetches the same 256 files from the same relative URLs. It is
// deliberately NOT an import: nothing in web_data/ may enter the JS bundle.
function copyDataset(): Plugin {
  return {
    name: "copy-web-data",
    apply: "build",
    closeBundle() {
      cpSync(resolve("web_data"), resolve("dist/web_data"), {
        recursive: true,
      });
    },
  };
}

// `base: "./"` makes built asset URLs relative, so the site works under any
// GitHub Pages path (username.github.io/your-repo/) without further config.
export default defineConfig({
  base: "./",
  plugins: [copyDataset()],
  build: {
    rollupOptions: {
      input: htmlEntries(),
    },
  },
});
