from pathlib import Path
from datetime import datetime, timezone
import ast, hashlib, json, subprocess, yaml

task = Path(__file__).resolve().parents[1]
sdk = task.parents[1]
poc = sdk.parent / 'project-tree-poc'
evidence = task / 'evidence/collaboration'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=sdk, text=True).strip()
assert commit == '7b2a0fdc292badcf1029a426c7bb6d22a593cb48'
assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=sdk, text=True)
manifest_path = task / 'evidence/structure/runtime-manifest.json'
manifest = json.loads(manifest_path.read_text())
assert manifest['sdkCommit'] == commit
for row in manifest['files']:
    p = task / 'runtime-structure' / row['path']
    if 'sha256' in row:
        assert sha(p) == row['sha256'], str(p)
    else:
        assert str(p.readlink()) == row['symlink'], str(p)
scripts = sorted((task / 'collaboration').glob('*.mjs'))
for p in scripts:
    subprocess.run(['node', '--check', str(p)], check=True)
ast.parse(Path(__file__).read_text())
rel = subprocess.check_output(['bash', '/data/swe/FramePilot/cachetree/.codex/skills/run-project-tree-poc/scripts/new_testbed.sh',
                              'collaboration-spinetree-grok'], cwd=poc, text=True).strip()
run = poc / rel
(run / 'shared-notes').mkdir()
(run / 'SPEC.md').write_text('''# Parallel ledger implementation

Produce three ES modules and tests. Use two independent child Agents for the
two implementation modules, then inspect their evidence and test the combined
behavior yourself. Each child owns only its module, corresponding tests, and
one notes file under shared-notes. Shared files are real: preserve peer work.

1. validation.mjs exports validateRow(row). Valid rows are non-null non-array
objects whose id is a string of 1..16 ASCII letters, digits, underscore or
hyphen, and amountMinor is an integer in [0, 1000000000]. Additional properties
are allowed. Return a boolean without throwing for invalid input. Its child
owns validation.test.mjs and shared-notes/validation.md.
2. aggregation.mjs exports aggregateValidRows(rows). Its precondition is an
array of at most 100 valid rows. Return {totalMinor, acceptedCount}; sum all
amountMinor exactly, including duplicate ids. Empty array gives zeroes. An
array of valid rows is the boundary: this module does not import validation or
filter inputs. Its child owns aggregation.test.mjs and shared-notes/aggregation.md.
3. Parent owns ledger.mjs and integration.test.mjs. Export summarizeRows(rows),
throw TypeError for non-array input, otherwise call the two modules to return
{totalMinor, acceptedCount, invalidIndexes}, preserving invalid index order.
The ledger CLI accepts one JSON array argument and prints the result as JSON.
Input arrays have at most 100 entries. Test the modules AND their integration.

Both children read this specification; neither waits for the other's output.
Use this same absolute Shared blackboard directory in both assignments:
''' + f'Shared blackboard: {run}/shared-notes\n' + '''
Each child may read peer notes once available; if absent it completes its own
contract and notes that limit. Do not overwrite a peer's files. Return checked
facts and bounded gaps. Parent must inspect outputs and independently check
their combination. Keep source, tests and evidence. Do not publish resources
or move/archive branches in this experiment.
''')
(run / 'GOAL.md').write_text('Implement independent validation and aggregation with two child Agents, then verify the integrated ledger and retain the work for targeted feedback.\n')
info = yaml.safe_load((run / 'manifest.yaml').read_text())
info.update(task='multi-agent-ledger-feedback', model='grok-4.7', provider='cachetree', thinking='high', slots=2,
            frozen_pack=None, official_score=None, verify_json=None, sdk_commit=commit,
            runtime_manifest=str(manifest_path), command=f'node {task}/collaboration/dialogue.mjs {run}')
(run / 'manifest.yaml').write_text(yaml.safe_dump(info, sort_keys=False))
before = evidence / 'stage-start-before'
before.mkdir()
for name in ['tree.yml', 'nodes/07-collaboration.md']:
    dest = before / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes((task / name).read_bytes())
tree = yaml.safe_load((task / 'tree.yml').read_text())
assert tree['active'] == '07-collaboration'
tree['nodes']['07-collaboration']['status'] = 'in_progress'
tree['updated_at'] = datetime.now(timezone.utc).isoformat()
(task / 'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False))
node = task / 'nodes/07-collaboration.md'
text = node.read_text().replace('status: ready', 'status: in_progress')
text = text.replace('next: 固定最新SDK，真实Spawn两子Agent typed return与父验收；独立确认支持域内mailbox路由和lease',
                    'next: 执行冻结真实Pi多进程离线用例，再运行双模块Agent任务、同B反馈与事实访谈')
node.write_text(text)
source_test = poc / 'src/poc/test/spinetree-root-capabilities-runtime.test.mjs'
refs = [Path(__file__).resolve(), *scripts, source_test, manifest_path, evidence / 'plan.md',
        run / 'SPEC.md', run / 'GOAL.md', run / 'manifest.yaml']
result = {'passed': True, 'testbed': str(run), 'sdkCommit': commit, 'runtimeFilesVerified': len(manifest['files']),
          'reusesImmutableRuntime': str(task / 'runtime-structure'), 'modelRequests': 0,
          'scriptSyntaxChecks': len(scripts),
          'offlineDerivation': 'Existing behavioral assertions retained; imports/project/output paths relocated only.',
          'references': [{'path': str(p), 'sha256': sha(p)} for p in refs]}
(evidence / 'preparation.json').write_text(json.dumps(result, indent=2) + '\n')
with (task / 'worklog.md').open('a') as f:
    f.write('\n07 prepared: two independent implementation children, parent integration checks and later supported same-Branch feedback. Frozen 7b2a0fd runtime reverified; child credentials delegated to read-only existing configuration without copying secrets. No model requests yet.\n')
print(json.dumps({k: v for k, v in result.items() if k != 'references'}))
