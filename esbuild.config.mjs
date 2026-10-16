import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { writeFile } from "node:fs/promises";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  write: !production
});

if (production) {
  const result = await context.rebuild();
  await context.dispose();
  // Keep vendor license notices intact while avoiding whitespace-only diff errors.
  const output = result.outputFiles.find(file => file.path.endsWith("main.js")).text;
  const notices = output.lastIndexOf("/*! Bundled license information:");
  await writeFile("main.js", notices >= 0 ? output.slice(0, notices) + output.slice(notices).replace(/[\t ]+$/gm, "") : output);
} else {
  await context.watch();
}
