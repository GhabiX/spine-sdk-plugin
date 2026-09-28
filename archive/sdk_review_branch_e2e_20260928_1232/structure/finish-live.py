from datetime import datetime, timezone
from pathlib import Path
import ast
import collections
import fcntl
import hashlib
import json
import re
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/structure'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/structure-spinetree-grok-20260928_1532')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
audit = json.loads((out / 'trace-audit.json').read_text())
assessment = json.loads((out / 'interaction-review.json').read_text())
assert audit['passed'] and audit['allAgentsEnded']
initial = json.loads((run / 'turn-1-state.json').read_text())
organized = json.loads((run / 'turn-2-state.json').read_text())
final = json.loads((run / 'final-state.json').read_text())
ready = json.loads((run / 'ready.json').read_text())
events = [json.loads(x) for x in (run / 'launch.log').read_text().splitlines()]
assert events[-1]['type'] == 'closed'
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
target = 'd2a213c8-fac4-443f-b3b8-f55af51e78ca'
parent = '445f37c8-8650-4815-832f-37695709911d'
before, after = initial['branches'][target], final['branches'][target]
assert before['parent'] == 'root' and before['status'] == 'capped'
assert after['parent'] == parent and after['status'] == 'archived'
assert organized['branches'][target] == after
for key in ['id', 'goal', 'memory', 'memorySource', 'memoryVersion', 'scopeBinding', 'skills', 'tools', 'constraints']:
    assert before.get(key) == after.get(key), key
assert initial['branches'][parent] == final['branches'][parent]
assert all(b['status'] in ['capped', 'archived'] for b in final['branches'].values() if b['id'] != 'root')
changes = [x for x in audit['structureChanges'] if x['branch'] == target]
assert len(changes) == len(audit['structureChanges'])
assert any('parent' in x['fields'] for x in changes)
archive = next(x for x in changes if 'status' in x['fields'])
new = [b for b in audit['createdBranches'] if audit['commitOrder'].index(b['commit']) > audit['commitOrder'].index(archive['commit'])]
assert new and all(final['branches'][b['branch']]['memoryVersion'] == 1 for b in new)
checks = [json.loads((out / ('candidate-' + label + '.json')).read_text()) for label in ['before', 'after']]
assert checks[0] == checks[1] and checks[0]['passed']
assert sha(Path(checks[0]['path'])) == checks[0]['sha256']
cli = json.loads((out / 'candidate-cli-errors.json').read_text())
assert cli['passed'] and cli['sha256'] == checks[0]['sha256']
assert all(c['returncode'] != 0 and c['stdout'] == '' for c in cli['cases'])
counts = dict(collections.Counter(c['name'] for c in audit['toolCalls']))
assert not any(counts.get(k, 0) for k in ['spine_spawn', 'spine_child_return', 'spinetree_execute', 'spinetree_rejuvenate'])
runtime = json.loads((out / 'runtime-manifest.json').read_text())
for row in runtime['files']:
    path = task / 'runtime-structure' / row['path']
    if 'sha256' in row:
        assert sha(path) == row['sha256'], str(path)
    else:
        assert str(path.readlink()) == row['symlink'], str(path)
old = (run / 'manifest.yaml').read_bytes()
(out / 'testbed-manifest-before-finish.yaml').write_bytes(old)
manifest = yaml.safe_load(old)
manifest.update(status='stopped', pid=ready['pid'], started_at=ready['at'], ended_at=events[-1]['at'], official_benchmark=False,
                official_score=None, spawn_count=0, mailbox_used=False, mechanism_verified=True,
                autonomous_usability=assessment['observedUsabilityPassed'])
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
with (run / 'worklog.md').open('a') as stream:
    stream.write('\nReal Grok structure task completed: completed validation branch moved beneath aggregation and archived; later obligations continued. Identity, memory and canonical sources retained; candidate unchanged. Allocation manifest remained prepared during interactive running; ready/launch records hold actual timestamps. Evidence: ' + str(out / 'live-report.md') + '\n')
with (run.parent / 'index.tsv').open('r+') as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    prior = stream.read()
    (out / 'testbed-index-before-finish.tsv').write_text(prior)
    rows = prior.splitlines()
    chosen = [i for i, row in enumerate(rows) if run.name in row]
    assert len(chosen) == 1
    fields = rows[chosen[0]].split('\t')
    assert len(fields) == 9
    fields[4], fields[7], fields[8] = 'stopped', '0', 'completed branch move/archive and later sampling passed; SDK 7b2a0fd'
    rows[chosen[0]] = '\t'.join(fields)
    stream.seek(0); stream.write('\n'.join(rows) + '\n'); stream.truncate()
paths = [out / 'trace-audit.json', out / 'runtime-manifest.json', out / 'interaction-review.json', run / 'manifest.yaml', run / 'worklog.md', run / 'launch.log', run / 'SPEC.md', run / 'GOAL.md',
         task / 'structure/audit-live.py', Path(__file__).resolve(), task / 'structure/dialogue.mjs', task / 'structure/verify-candidate.mjs',
         *sorted(out.glob('candidate-*.json')), *sorted(run.glob('*.mjs'))]
hashes = {str(p): sha(p) for p in paths}
hashes.update(audit['hashes'])
result = {'completedAt': datetime.now(timezone.utc).isoformat(), 'mechanismPassed': True, 'realAgentWorkflowPassed': True,
          'observedUsabilityPassed': assessment['observedUsabilityPassed'], 'generalUsabilityEstablished': False,
          'prompts': len(list(run.glob('turn-*-input.json'))), 'closeReminder': assessment['closeReminder'],
          'sdkCommit': ready['sdkCommit'], 'runtimeFilesVerified': len(runtime['files']), 'target': target, 'newParent': parent,
          'structureChanges': changes, 'branchesCreatedAfterArchive': new, 'identityMemorySourceRetained': True,
          'canonicalMemoryVerified': True, 'noBranchRemoved': True, 'artifactUnchanged': True, 'hostCheck': checks[0], 'additionalCliErrorCases': len(cli['cases']),
          'toolCounts': counts, 'usage': audit['usage'], 'sessionsEnded': True, 'interaction': assessment,
          'limits': ['The prompt specified which completed evidence to move and archive; the Agent chose the tool sequence.',
                     'Move changes project parent while canonical history remains fixed. Archive preserves the Branch record and does not prune context.',
                     'No arbitrary split, UUID merge, live-work relocation, Spawn or reexecution was exercised in this real run.',
                     'Successful task/retrospective in this run does not erase earlier Close omissions. Skill causality and general usability are not established.'],
          'hashes': hashes}
(out / 'live-result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
samplings = sum(s['samplings'] for s in audit['sessions'])
pairs = sum(s['toolPairs'] for s in audit['sessions'])
offers = sum(s['offerCount'] for s in audit['sessions'])
report = f'''# 已完成分支移动、归档与继续工作：真实 Agent

指定结构工作流通过。Grok 4.7 high，冻结 SDK `7b2a0fd`，单 Agent，独立 testbed `{run.name}`。这是机制和可用性 PoC，不是官方 benchmark。

Agent 先完成 ledger 校验、汇总和组合检查，保留各自的完成分支；模型自测校验3项、汇总6项、组合9项通过。主机独立检查119个校验输入、6个汇总批次、6个非数组输入和1个CLI用例通过。两个额外CLI错误路径也由主机复核，均退出1且stdout为空。产物 SHA256 `{checks[0]['sha256']}` 在整理前后完全相同。

后续请求给出两个真实 Branch ID 和整理目标，没有规定 read/change 的调用顺序。校验分支 `{target}` 从 root 移入汇总分支 `{parent}`，然后归档。Git 历史确认除 project parent、status、revision 外，UUID、goal、memory v1、memorySource、scopeBinding、skills/tools/constraints 不变。汇总分支本身不变。已归档结果在后续采样中仍可读，且没有节点被移除。

归档之后新建了 {len(new)} 个完成义务，包括 CLI 错误路径检查。所有新分支均保留 canonical memory v1；原 Agent 的 H、session、binding、lease 保持。全轨迹 {samplings} 次采样/{samplings} canonical receipts、{pairs} 组工具调用结果、{offers} 个 offer 和 {audit['gitSnapshots']} 个 Git 状态通过核对。最终回到 root，registry ended。

## 交互核对

{assessment['summary']}

实际提示 {result['prompts']} 次；Close提醒：{assessment['closeReminder']}。模型公开回答及核对限制见[交互审查](interaction-review.json)。本轮通过不能推翻03/04出现过的漏Close，也不证明已获得一般性的自主可用性。

## 语义边界

旧memory还保留当时的“Do not archive or move”以及原未测范围；后续明确请求没有被阻挡，新检查写进后继义务，没有改写旧v1。这类过时阶段指令仍需在组合测试中审查。

这次 move 只重组项目关系，不重写 canonical parent 或证据来源。archive 保留节点和历史，也不裁切 canonical 上下文。新义务综合两个完成结果属于工作归并，不是把两个 UUID 合成一个；不存在已验证的任意 split/merge/prune 接口。

usage：`{json.dumps(audit['usage'])}`。reasoning 已包含在 output，美元费用未知。冻结运行时 {len(runtime['files'])} 项文件/链接保持不变。

## 证据

- [完整轨迹及 Git 变化](trace-audit.json)
- [整理前检查](candidate-before.json)、[整理后检查](candidate-after.json)
- [结果与 hash](live-result.json)
- [第二轮整理和继续工作]({run}/turn-2-answer.json)
- [最终状态]({run}/final-state.json)
'''
(out / 'live-report.md').write_text(report)
for path in [task / 'structure/audit-live.py', Path(__file__).resolve()]:
    ast.parse(path.read_text())
for path, digest in hashes.items():
    assert sha(Path(path)) == digest, path
links = re.findall(r'\]\(([^)]+)\)', report)
for link in links:
    assert (out / link).exists(), link
for path in [out / 'live-report.md', task / 'structure/audit-live.py', Path(__file__).resolve()]:
    assert all(line == line.rstrip() for line in path.read_text().splitlines()), str(path)
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True, capture_output=True)
validation = {'passed': True, 'hashReferences': len(hashes), 'runtimeFilesVerified': len(runtime['files']), 'pythonAst': 2,
              'links': len(links), 'whitespace': True, 'gitDiffCheck': True, 'resultSha256': sha(out / 'live-result.json'), 'reportSha256': sha(out / 'live-report.md')}
(out / 'live-validation.json').write_text(json.dumps(validation, indent=2) + '\n')
print(json.dumps(validation))
