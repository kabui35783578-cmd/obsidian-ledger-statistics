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
  entryPoints: ["src/ai.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/ai.cjs",
  plugins: [{ name: "no-network-tests", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export function requestUrl() { throw new Error("Network disabled in tests"); }' }));
  } }]
});
