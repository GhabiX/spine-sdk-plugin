import assert from "node:assert/strict";
import { readFile, mkdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { createNodeSpineRuntime } from "@spinejit/spine-sdk/node";
import { SPINE_CANONICAL_PLUGIN_MANIFEST } from "@spinejit/pi-spinejit/pi/extension";

const require = createRequire(import.meta.url);
const packageDir = dirname(dirname(fileURLToPath(import.meta.resolve("@spinejit/pi-spinejit"))));
const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
assert.equal(manifest.name, "@spinejit/pi-spinejit");
assert.equal(manifest.version, "0.1.0");
assert.equal(SPINE_CANONICAL_PLUGIN_MANIFEST.id, manifest.name);
assert.equal(manifest.dependencies["@spinejit/spine-sdk"], "0.1.0");
assert.equal(manifest.dependencies["@spinejit/spine-host"], "0.1.0");
assert.ok((await realpath(packageDir)).startsWith(process.cwd() + "/node_modules/"));
assert.throws(() => require.resolve("@spinejit/spine-plugin"), {code: "MODULE_NOT_FOUND"});
for (const subpath of Object.keys(manifest.exports)) {
  await import(manifest.name + (subpath === "." ? "" : subpath.slice(1)));
}
const configToml = await readFile(join(packageDir, "spine.toml"), "utf8");
const runtime = createNodeSpineRuntime({thread: "rename-release-smoke", features: ["jit", "spawn"], configToml});
const cwd = join(process.cwd(), "pi-workspace");
const agentDir = join(process.cwd(), "pi-agent");
await mkdir(cwd, {recursive: true});
await mkdir(agentDir, {recursive: true});
try {
  const expected = runtime.toolCatalog().map(({id, description, parameters}) => ({name: `spine_${id}`, description, parameters}));
  const loaded = await discoverAndLoadExtensions([packageDir], cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const actual = loaded.extensions.flatMap(extension => [...extension.tools.values()].map(({definition: {name, description, parameters}}) => ({name, description, parameters})));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  assert.equal(actual.length, 4);
  console.log(JSON.stringify({package: manifest.name, version: manifest.version, manifestId: SPINE_CANONICAL_PLUGIN_MANIFEST.id, toolNames: actual.map(x => x.name), exports: Object.keys(manifest.exports), errors: loaded.errors, packageDir}, null, 2));
} finally {
  runtime.dispose();
}
