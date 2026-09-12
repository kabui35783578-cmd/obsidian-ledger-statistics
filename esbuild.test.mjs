import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/core.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/core.cjs"
});
