// Build the guest straight into the assets directory.
//   node build-guest.mjs <build.json> <output-dir>
//
// `gondolin build` does the same and then copies the result into gondolin's own image store
// under ~/.cache/gondolin/images. The lane boots from the assets directory and never reads that
// store, so each rebuild left another 8 GB behind: six builds had taken 49 GB by 2026-09-30,
// on a disk with 13 GB free. Calling the build directly leaves one copy.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildAssets, parseBuildConfig } from "@earendil-works/gondolin";

const [configFile, outputDir] = process.argv.slice(2);
if (!configFile || !outputDir) {
  console.error("usage: node build-guest.mjs <build.json> <output-dir>");
  process.exit(2);
}
const configPath = resolve(configFile);
const result = await buildAssets(parseBuildConfig(readFileSync(configPath, "utf8")), {
  outputDir: resolve(outputDir),
  configDir: dirname(configPath),
  verbose: true,
});
console.log(`guest written to ${result.outputDir}`);
