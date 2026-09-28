from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import yaml

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
testbed = Path(sys.argv[1]).resolve()
runtime = task / 'runtime-composition'
manifest = task / 'evidence/collaboration/runtime-manifest-live.json'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

assert testbed.parent == repo.parent / 'project-tree-poc/temp/testbed'
assert testbed.exists() and not (testbed / '.spinetree').exists()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
assert commit == 'eeea5d68ff1231be43206c4038f43dc2154d8ddf'
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo, text=True)
source = json.loads(manifest.read_text())
assert source['sdkCommit'] == commit
for row in source['files']:
    path = runtime / row['path']
    if 'sha256' in row:
        assert sha(path) == row['sha256'], str(path)
    else:
        assert path.resolve().is_relative_to(runtime)
        assert str(path.readlink()) == row['symlink']

(testbed / 'SPEC.md').write_text('''# Composition contract

Use the exposed SpineTree contracts to complete one integrated ledger task.
Keep the original validation and aggregation Branches addressable. Publish a
versioned shared checker and a local refinement, then create a completed
Branch with memory v1. Reexecute that same Branch to memory v2 while retaining
the old source. Move the completed detail Branch, archive it, and continue
with a fresh obligation. Spawn two owned checks, observe their typed returns,
and have the parent verify the returned files. A readback must distinguish
current binding, historical allocation, operation state, resource version and
archived status. Do not delete files, merge UUIDs, prune canonical memory, or
trust an Agent self-report without host evidence.
''')
(testbed / 'GOAL.md').write_text('''Implement and verify the integrated ledger workflow. Preserve source and
memory history, retain Branch identity through reexecution and archive, and
finish every active Branch with Close. Record checked facts and failures.
''')
info = yaml.safe_load((testbed / 'manifest.yaml').read_text())
info.update(task='composition-lifecycle-memory-resource-structure-collaboration', model='grok-4.7', provider='cachetree', thinking='high', slots=2,
            sdk_commit=commit, runtime_manifest=str(manifest), command=f'node {task}/composition/dialogue.mjs {testbed}')
(testbed / 'manifest.yaml').write_text(yaml.safe_dump(info, sort_keys=False))
result = {'passed': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'testbed': str(testbed),
          'sdkCommit': commit, 'runtimeFilesVerified': len(source['files']), 'runtimeManifestSha256': sha(manifest),
          'references': [{'path': str(p), 'sha256': sha(p)} for p in [Path(__file__), manifest, testbed / 'SPEC.md', testbed / 'GOAL.md', testbed / 'manifest.yaml']]}
(task / 'evidence/composition').mkdir(exist_ok=True)
(task / 'evidence/composition/preparation.json').write_text(json.dumps(result, indent=2) + '\n')
with (task / 'worklog.md').open('a') as f:
    f.write('\n08 composition prepared: new isolated testbed and immutable eeea5d68 runtime; mixed collaboration and structure fixtures will run sequentially before real Agent composition.\n')
print(json.dumps({k: v for k, v in result.items() if k != 'references'}))
