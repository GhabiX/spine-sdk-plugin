from datetime import datetime, timezone
from pathlib import Path
import ast
import hashlib
import json
import re
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
ev = task / 'evidence/collaboration/git-lock'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
commit = 'eeea5d68ff1231be43206c4038f43dc2154d8ddf'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip() == commit
paths = ['packages/spinetree-plugin/src/index.ts', 'packages/spinetree-plugin/README.md',
         'packages/spinetree-plugin/test/git-ref-lock.test.mjs']
assert sorted(subprocess.check_output(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], cwd=repo, text=True).splitlines()) == sorted(paths)
for name in paths:
    assert subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=repo) == (repo / name).read_bytes()
log = (ev / 'offline-lockfix.log').read_text()
assert '# pass 1' in log and '# fail 0' in log
run = Path(re.search(r'Retained mixed proof: (.+)', log).group(1))
result = json.loads((run / 'result.json').read_text())
expected = {'samples': 46, 'processes': 5, 'sessions': 6, 'spawn': 2, 'childReturns': 4,
            'completedReexecutions': 1, 'observed': 1, 'memoryVersion': 2,
            'externalProviderRequests': 0, 'networkAttempts': 0}
for key, value in expected.items():
    assert result[key] == value, (key, result[key])
assert all(binding['status'] == 'ended' for binding in result['registry'].values())
session_paths = sorted((run / 'sessions').rglob('*.jsonl'))
assert len(session_paths) == 6
faults = 0
canonical = 0
for path in session_paths:
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    session = next(row for row in rows if row['type'] == 'session')
    start = next(i for i, row in enumerate(rows) if row.get('customType') == 'spinetree.scope-import.v1' and row.get('data', {}).get('state') == 'start' and row['data']['sessionId'] == session['id'])
    own = rows[start:]
    faults += sum(row.get('customType') == 'spine.fault.v1' for row in own)
    canonical += sum(row.get('customType') == 'spine.canonical' for row in own)
assert faults == 0
manifest_path = ev / 'runtime-manifest-lockfix.json'
manifest = json.loads(manifest_path.read_text())
runtime = Path(manifest['runtime'])
for row in manifest['files']:
    path = runtime / row['path']
    if 'sha256' in row:
        assert sha(path) == row['sha256'], path
    else:
        assert str(path.readlink()) == row['symlink'], path
for name in ['src/index.ts', 'README.md', 'dist/index.js', 'dist/index.js.map', 'dist/index.d.ts', 'dist/index.d.ts.map']:
    assert (runtime / 'sdk/packages/spinetree-plugin' / name).read_bytes() == (repo / 'packages/spinetree-plugin' / name).read_bytes(), name
# The private proof snapshot preceded the final test-only timing/comment changes.
assert (runtime / 'sdk/packages/spinetree-plugin/test/git-ref-lock.test.mjs').read_bytes() != (repo / paths[2]).read_bytes()
source = (task / 'collaboration/offline.test.mjs').read_text()
derived = source.replace(str(task / 'runtime-structure/poc'), str(runtime / 'poc')).replace(
    str(repo / 'temp/null/20260928_1610/collaboration-offline'), str(repo / 'temp/null/20260928_1700/collaboration-offline-lockfix'))
assert derived == (ev / 'offline-lockfix.test.mjs').read_text()
tests = (ev / 'tree-tests-final.log').read_text()
assert '# pass 161' in tests and '# fail 0' in tests
subprocess.run(['git', 'diff', '--check'], cwd=repo, check=True)
for name in ['collaboration/prepare-lockfix.py', 'collaboration/finish-lockfix.py']:
    ast.parse((task / name).read_text())
subprocess.run(['node', '--check', str(repo / paths[2])], check=True)
tree = yaml.safe_load((task / 'tree.yml').read_text())
assert tree['active'] == '07-collaboration'
assert tree['nodes']['07-collaboration']['status'] == 'in_progress'
assert tree['nodes']['08-composition']['status'] == 'pending'
report = ev / 'report.md'
report.write_text('''# 07 Git ref-lock 修复与离线重跑

修复提交 `eeea5d68ff1231be43206c4038f43dc2154d8ddf`，仅包括 SpineTree
`index.ts`、README 和三个锁竞争回归测试。`update-ref` 使用单次
`core.filesRefLockTimeout=1000` 设置，保留 expected-old CAS；未改变错误分类、
Scope 重试次数或 canonical 语义。

原离线用例在 grandchild turn_end 持久化时遇到 HEAD.lock，留下
post-commit-sink-failed。旧失败、Git 2.25 不支持交互事务的测试夹具失败、
以及后续夹具修正均保留。先前临时目录与删除规范违规见
`fixture-diagnosis.json`；该行为没有被当作修复结果。

受控 HEAD.lock 回归验证短锁释放后成功、持久锁有界失败、竞争 HEAD 不被覆盖。
这些是合成锁夹具，并非第二个真实 Git writer 全程持锁；多进程整合提供真实
Git 并发补充证据。最终 `tree-tests-final.log` 显示 161/161 通过。

原行为断言仅替换导入与输出路径后，在新的私有快照运行通过：46 scripted
采样、5 进程、6 sessions/registry entries、2 Spawn、4 typed returns、1 次
同 B 再执行至 memory v2、1 条 observed mailbox。全部 registry ended，
零 fault、零网络与真实模型请求。根资源、局部覆盖及父级整合断言也通过。

快照 `runtime-collaboration-lockfix` 包含 16,564 文件，生产源码和生成代码
与提交一致；仅回归测试是最终测试时序/注释修订前的版本，manifest 如实保留。
旧 runtime-structure 未修改。此处不把该快照宣称为提交的逐文件复制。

07 状态仍为 in_progress：真实 Grok 多 Agent 协作、父验收和事实复盘还未运行。
下一步固定当前提交的新快照再进入真实验证。08/09 尚未完成。
''')
refs = [Path(__file__).resolve(), task / 'collaboration/prepare-lockfix.py', report,
        ev / 'diagnosis.json', ev / 'fixture-diagnosis.json', ev / 'before.log', ev / 'before-02.log',
        ev / 'tree-tests-final.log', ev / 'offline-lockfix.log', ev / 'offline-lockfix.test.mjs',
        manifest_path, run / 'result.json', run / 'provider-records.jsonl', *session_paths,
        *(repo / name for name in paths)]
validation = {'passed': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'commit': commit,
              'packageTests': 161, 'offline': {**expected, 'faults': faults},
              'runtimeFilesVerified': len(manifest['files']),
              'productionRuntimeMatchesCommit': True, 'snapshotTestOnlyDeltaAcknowledged': True,
              'realAgentCollaboration': 'pending', 'stageStatus': 'in_progress',
              'references': [{'path': str(path), 'sha256': sha(path)} for path in refs]}
(ev / 'validation.json').write_text(json.dumps(validation, indent=2) + '\n')
print(json.dumps({k: v for k, v in validation.items() if k != 'references'}))
