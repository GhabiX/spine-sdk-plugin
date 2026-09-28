"""Read-only final integrity and process check for the collaboration run."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
out = task / 'evidence/collaboration'
manifest_path = out / 'runtime-manifest-live.json'
manifest = json.loads(manifest_path.read_text())
runtime = Path(manifest['runtime'])
run = repo.parent / 'project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
expected = {item['path']: item for item in manifest['files']}
assert len(expected) == len(manifest['files']) == 16564
actual = set()
for directory, dirs, files in os.walk(runtime, followlinks=False):
    for name in dirs + files:
        path = Path(directory) / name
        if path.is_symlink() or path.is_file():
            actual.add(str(path.relative_to(runtime)))
assert actual == expected.keys(), {'missing': sorted(expected.keys() - actual), 'extra': sorted(actual - expected.keys())}

def verify(item):
    path = runtime / item['path']
    if 'symlink' in item:
        assert path.is_symlink() and str(path.readlink()) == item['symlink'], item['path']
        assert path.resolve().is_relative_to(runtime), item['path']
        return 'symlink'
    assert not path.is_symlink() and path.stat().st_size == item['bytes'], item['path']
    assert sha(path) == item['sha256'], item['path']
    return 'file'

with ThreadPoolExecutor(max_workers=8) as pool:
    types = list(pool.map(verify, manifest['files']))
print(f'Runtime manifest verified: {len(types)} entries', flush=True)
commit = manifest['sdkCommit']
listing = subprocess.check_output(['git', 'ls-tree', '-r', '-z', commit, '--', 'packages'], cwd=repo)
blobs = {}
for entry in listing.split(b'\0'):
    if entry:
        metadata, name = entry.split(b'\t', 1)
        blobs[name.decode()] = metadata.split()[2].decode()
for name in manifest['commitFilesChecked']:
    data = (runtime / 'sdk' / name).read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    assert blob == blobs[name], name
ready_path, final_path = run / 'ready.json', run / 'final-state.json'
ready, final = json.loads(ready_path.read_text()), json.loads(final_path.read_text())
events = [json.loads(line) for line in (run / 'launch.log').read_text().splitlines()]
assert events[-1]['type'] == 'closed'
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=run / '.spinetree', text=True).strip()
assert head == events[-1]['head']
stored = json.loads(subprocess.check_output(['git', 'show', head + ':state.json'], cwd=run / '.spinetree'))
assert stored == final
assert len(final['registry']) == 4 and all(binding['status'] == 'ended' for binding in final['registry'].values())
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
assert not Path('/proc', str(ready['pid'])).exists(), 'Original runner PID still exists; inspect before concluding.'
matches, denied = [], []
needles = [str(run), str(runtime), str(task / 'collaboration/dialogue.mjs'), str(task / 'collaboration/child-preload.mjs')]
for process in Path('/proc').iterdir():
    if not process.name.isdigit():
        continue
    try:
        argv = (process / 'cmdline').read_bytes().split(b'\0')
    except (FileNotFoundError, ProcessLookupError):
        continue
    except PermissionError:
        denied.append(process.name)
        continue
    if argv and Path(argv[0].decode(errors='replace')).name == 'node':
        command = b' '.join(argv).decode(errors='replace')
        if any(needle in command for needle in needles):
            matches.append(int(process.name))
assert not matches and not denied, {'matchingNodePids': matches, 'unreadablePids': denied}
refs = [Path(__file__).resolve(), manifest_path, ready_path, final_path, run / 'launch.log', out / 'trace-audit.json']
result = {'passed': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'sdkCommit': commit,
          'runtimeEntriesVerified': len(types), 'files': types.count('file'), 'symlinks': types.count('symlink'),
          'unexpectedRuntimeEntries': [], 'commitFilesVerified': len(manifest['commitFilesChecked']),
          'finalHead': head, 'registryOwnersEnded': len(final['registry']), 'rootCursor': [1],
          'readyAt': ready['at'], 'closedAt': events[-1]['at'], 'originalRunnerPid': ready['pid'],
          'originalRunnerPidAbsent': True, 'matchingNodePids': matches, 'unreadablePids': denied,
          'references': [{'path': str(p), 'sha256': sha(p)} for p in refs],
          'limits': ['Process inspection is a point-in-time check for Node commands tied to this run or frozen runtime.',
                     'Artifact identity does not prove deterministic replay or parallel speedup.']}
(out / 'runtime-close-validation.json').write_text(json.dumps(result, indent=2) + '\n')
report = f'''# 07 协作 runtime 与终态核验

核验通过，时间 `{result['checkedAt']}`。

- `runtime-collaboration-live` 的 {len(types)} 项全部匹配冻结清单（{types.count('file')} 文件、{types.count('symlink')} 符号链接），没有额外项；链接均留在私有快照内。
- 清单中的 {len(manifest['commitFilesChecked'])} 个已跟踪 package 文件逐项匹配 SDK 提交 `{commit}` 的 Git blob。
- `final-state.json` 与 Git HEAD `{head}` 的 `state.json` 相同；四个 registry owner 全部 ended，父方回到 `[1]`。
- runner 在 `{events[-1]['at']}` 记录 closed；原 PID {ready['pid']} 不存在。本次 `/proc` 扫描无关联本轮路径的 Node 进程，无不可读 PID。
- testbed 的 manifest/index 仍需整合方从旧状态更新为 stopped；本检查不改 testbed 或任务树。

这是运行后文件身份和当前进程终态检查，不证明可重复生成或协作加速。

来源与逐项计数见 [验证记录](runtime-close-validation.json)；[原冻结清单](runtime-manifest-live.json) 保持不变。
'''
(out / 'runtime-close-review.md').write_text(report)
blackboard = task / 'blackboard/collaboration-close'
blackboard.mkdir(parents=True, exist_ok=True)
with (blackboard / 'runtime.md').open('a') as stream:
    stream.write(f'\nRuntime final verification passed at {result["checkedAt"]}: 16,564 manifest entries, 92 commit blobs, four ended owners, runner PID absent, no matching Node processes. Report: {out / "runtime-close-review.md"}. No testbed or production changes.\n')
print(json.dumps({k: v for k, v in result.items() if k not in ('references', 'limits')}), flush=True)
