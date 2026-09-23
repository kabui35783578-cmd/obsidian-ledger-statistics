import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/core.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/core.cjs"
});

await esbuild.build({
  entryPoints: ["src/ai.ts", "src/advice-lifecycle.ts", "src/repository.ts", "src/request-gate.ts", "src/budget-monitor.ts", "src/view.ts", "src/insights.ts", "src/fixed-expenses.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  plugins: [{ name: "no-network-tests", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
      export function requestUrl(request) {
        if (!globalThis.__ledgerTestRequest) throw new Error("Network disabled in tests");
        return globalThis.__ledgerTestRequest(request);
      }
      export const TFile = globalThis.__ledgerTestTFile ??= class { constructor(path) { this.path = path; this.extension = "md"; } };
      export class ItemView {}
      export class MarkdownView {}
      export class Menu {}
      export class Modal {}
      export class FuzzySuggestModal {}
      export class Setting {}
      export class Notice { constructor(message) { (globalThis.__ledgerTestNotices ??= []).push(message); } }
      export const Platform = { isMobile: false };
      export function setIcon() {}
    ` }));
  } }]
});
