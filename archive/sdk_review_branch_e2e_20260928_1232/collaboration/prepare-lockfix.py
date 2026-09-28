from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
base = task / "runtime-structure"
runtime = task / "runtime-collaboration-lockfix"
evidence = task / "evidence/collaboration/git-lock"
base_manifest_path = task / "evidence/structure/runtime-manifest.json"
base_manifest = json.loads(base_manifest_path.read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()

assert not runtime.exists(), runtime
assert base_manifest["sdkCommit"] == "7b2a0fdc292badcf1029a426c7bb6d22a593cb48"
subprocess.run(["cp", "-a", "--reflink=auto", str(base), str(runtime)], check=True)

source_package = repo / "packages/spinetree-plugin"
runtime_package = runtime / "sdk/packages/spinetree-plugin"
for name in ("src", "dist", "test", "README.md"):
    source, destination = source_package / name, runtime_package / name
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)
    else:
        shutil.copy2(source, destination)

files = []
for path in sorted(runtime.rglob("*")):
    if path.is_symlink():
        assert path.resolve().is_relative_to(runtime), path
        files.append({"path": str(path.relative_to(runtime)), "symlink": str(path.readlink())})
    elif path.is_file():
        files.append({"path": str(path.relative_to(runtime)), "sha256": sha(path), "bytes": path.stat().st_size})

base_files = {row["path"]: row for row in base_manifest["files"]}
changed = [row["path"] for row in files if base_files.get(row["path"]) != row]
assert changed
assert all(path.startswith("sdk/packages/spinetree-plugin/") for path in changed), changed

source_test = task / "collaboration/offline.test.mjs"
derived_test = evidence / "offline-lockfix.test.mjs"
text = source_test.read_text()
old_project = str(base / "poc")
assert text.count(old_project) >= 2
text = text.replace(old_project, str(runtime / "poc"))
text = text.replace(
    "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/temp/null/20260928_1610/collaboration-offline",
    "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/temp/null/20260928_1700/collaboration-offline-lockfix",
)
derived_test.write_text(text)
subprocess.run(["node", "--check", str(derived_test)], check=True)

manifest = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "baseSdkCommit": base_manifest["sdkCommit"],
    "baseRuntimeManifestSha256": sha(base_manifest_path),
    "runtime": str(runtime),
    "files": files,
    "changedFiles": changed,
}
manifest_path = evidence / "runtime-manifest-lockfix.json"
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
result = {
    "passed": True,
    "runtimeFiles": len(files),
    "changedFiles": changed,
    "derivedTest": str(derived_test),
    "manifest": str(manifest_path),
    "manifestSha256": sha(manifest_path),
    "sourceTestSha256": sha(source_test),
    "references": [
        {"path": str(path), "sha256": sha(path)}
        for path in (Path(__file__).resolve(), source_test, derived_test, manifest_path, base_manifest_path)
    ],
}
(evidence / "preparation-lockfix.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({key: value for key, value in result.items() if key != "references"}, indent=2))
