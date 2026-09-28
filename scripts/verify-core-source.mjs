import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "core-source.json"), "utf8"));
const snapshot = source.developmentSnapshot;
assert.equal(snapshot.kind, "revision-plus-patch");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(sha256(join(root, snapshot.patch)), snapshot.patchSha256, "core patch hash");

// An optional source root verifies a reconstructed archive without building it.
const sourceRoot = process.argv[2] === undefined
  ? resolve(root, source.developmentPath, ...source.subdirectory.split("/").map(() => ".."))
  : resolve(process.argv[2]);
const coreRoot = join(sourceRoot, source.subdirectory);
if (process.argv[2] === undefined) {
  const metadata = JSON.parse(execFileSync("cargo", [
    "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1",
    "--manifest-path", join(root, "Cargo.toml"),
  ], { encoding: "utf8" }));
  const binding = metadata.packages.find((pkg) => pkg.name === "spine-wasm");
  const dependency = binding.dependencies.find((dep) => dep.name === source.package);
  assert.equal(resolve(dependency.path), coreRoot, "Cargo must use the declared core source");
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    assert(entry.isFile(), `unsupported core source entry: ${path}`);
    return [relative(sourceRoot, path)];
  });
}
const expectedCoreFiles = Object.keys(snapshot.files)
  .filter((path) => path.startsWith(`${source.subdirectory}/`)).sort();
assert.deepEqual(files(coreRoot).sort(), expectedCoreFiles, "core source file inventory");
for (const [path, expected] of Object.entries(snapshot.files)) {
  assert.equal(sha256(join(sourceRoot, path)), expected, `core source hash: ${path}`);
}
console.log(JSON.stringify({
  source: sourceRoot,
  revision: source.revision,
  patchSha256: snapshot.patchSha256,
  verifiedFiles: Object.keys(snapshot.files).length,
}));
