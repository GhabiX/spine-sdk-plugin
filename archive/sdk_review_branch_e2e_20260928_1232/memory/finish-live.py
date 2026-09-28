from datetime import datetime, timezone
from pathlib import Path
import ast
import fcntl
import hashlib
import json
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/memory'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/memory-spinetree-grok-20260928_1352')
audit = json.loads((out / 'trace-audit.json').read_text())
assert audit['passed'] and audit['allAgentsEnded']
first_check = json.loads((out / 'candidate-initial.json').read_text())
last_check = json.loads((out / 'candidate-revised.json').read_text())
assert first_check['passed'] and last_check['passed']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(run / 'parser.mjs') == last_check['sha256']
state = json.loads((run / 'final-state.json').read_text())
ready = json.loads((run / 'ready.json').read_text())
assert state['registry'][ready['agentId']]['scopeCursor'] == [1]
assert all(b['status'] == 'capped' for b in state['branches'].values() if b['id'] != 'root')
counts = {}
for call in audit['toolCalls']:
    counts[call['name']] = counts.get(call['name'], 0) + 1
assert counts['spinetree_rejuvenate'] == counts['spinetree_send'] == counts['spinetree_dispatch'] == counts['spinetree_observe'] == 1
assert not any(counts.get(k, 0) for k in ['spine_spawn', 'spine_child_return', 'spinetree_change', 'spinetree_execute'])
events = [json.loads(line) for line in (run / 'launch.log').read_text().splitlines()]
assert events[-1]['type'] == 'closed'
old = (run / 'manifest.yaml').read_bytes()
(out / 'testbed-manifest-before-finish.yaml').write_bytes(old)
manifest = yaml.safe_load(old)
manifest.update(status='stopped', started_at=ready['at'], ended_at=events[-1]['at'], pid=ready['pid'], official_benchmark=False,
                official_score=None, spawn_count=0, mailbox_used=True, mechanism_verified=True,
                autonomous_usability='memory revision workflow passed; retrospective Close reminder required; binding display ambiguity')
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
with (run / 'worklog.md').open('a') as stream:
    stream.write('\nSame-Branch reexecution completed with real Grok 4.7 high. v1 and v2 candidates each passed 115 host cases. The parent selected the tool sequence, sent the revised obligation, dispatched it and tested returned output. Old memory/source retained. Retrospective again needed a Close reminder and identified historical reexecution.binding.status ambiguity. All sessions disposed. Evidence: ' + str(out) + '/live-report.md\n')
with (run.parent / 'index.tsv').open('r+') as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    before = stream.read()
    (out / 'testbed-index-before-finish.tsv').write_text(before)
    rows = before.splitlines()
    chosen = [i for i, row in enumerate(rows) if run.name in row]
    assert len(chosen) == 1
    fields = rows[chosen[0]].split('\t')
    assert len(fields) == 9
    fields[4], fields[7], fields[8] = 'stopped', '0', 'same-Branch v1-to-v2 passed; read/send/dispatch/observe; usability follow-ups; SDK 68fa324'
    rows[chosen[0]] = '\t'.join(fields)
    stream.seek(0); stream.write('\n'.join(rows) + '\n'); stream.truncate()
paths = [out / 'trace-audit.json', out / 'candidate-initial.json', out / 'candidate-revised.json', run / 'manifest.yaml', run / 'worklog.md', run / 'launch.log', run / 'parser.mjs', run / 'parser.test.mjs', run / 'SPEC.md', task / 'memory/audit-live.py', task / 'memory/finish-live.py', task / 'memory/dialogue.mjs', task / 'memory/verify-candidate.mjs']
hashes = {str(p): sha(p) for p in paths}
hashes.update(audit['hashes'])
result = {'completedAt': datetime.now(timezone.utc).isoformat(), 'mechanismPassed': True, 'realAgentWorkflowPassed': True, 'autonomousUsabilityPassed': False,
          'sameBranch': audit['sameBranch'], 'versions': [1, 2], 'functionalChecks': [first_check['cases'], last_check['cases']], 'usage': audit['usage'],
          'sessionsEnded': True, 'toolCounts': counts, 'interactionPrompts': 4,
          'limits': ['The task explicitly requested same-Branch reexecution; tool sequence was selected by the Agent.',
                     'Parent read v1 and sent the changed contract. No child spinetree_read of v1 was observed; persistence is not proof of direct child memory use.',
                     'The retrospective needed a final Close reminder; general lifecycle usability remains unresolved.',
                     'Historical reexecution.binding.status remains running after actual registry completion. Review read-result clarity before changing ownership semantics.',
                     'Observed mailbox status was host-verified; parent read/dispatch results did not expose an observed field.',
                     'No independent parallel Spawn, resource evolution or causal benefit was tested.'], 'hashes': hashes}
(out / 'live-result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
errors = [e for s in audit['sessions'] for e in s['providerErrors'] + s['toolErrors']]
report = f'''# 同一 Branch 再执行与 memory 修订：真实 Agent

机制和实际任务流程通过；自主交互可用性仍有未通过项。SDK `68fa324`，Grok 4.7 high，独立 testbed `{run.name}`。本轮非官方 benchmark，无官方分数。

## 可复核结果

- 原 Branch `{audit['sameBranch']}` 的 UUID、parent、goal 不变，memory 1→2；v1 正文、来源和旧 scopeBinding 保存在 `reexecution.source`，v2 对应新会话的 canonical receipt。
- 初版和修订版分别通过 {first_check['cases']} / {last_check['cases']} 例独立功能检查；候选 hash 分别为 `{first_check['sha256']}` 和 `{last_check['sha256']}`。
- 初版模型自测 4 项，修订执行和父方各运行 5 项自测。父方在 dispatch 后重新 read Branch、读实现/规格并执行测试，没有把消息投递当作验收。
- 真实工具序列：read → rejuvenate → send → dispatch；接收方 observe → Open/实现/检查/Close；父方 read/检查/Close。每个通信工具各 1 次，Spawn/树修改/资源执行为零。
- {len(audit['sessions'])} 个真实会话、{sum(s['samplings'] for s in audit['sessions'])} 次采样和 canonical receipt、{len(audit['toolCalls'])} 组配对工具结果；框架/工具/模型错误记录 {len(errors)}。结束后两个 registry owner 均 ended。
- usage `{json.dumps(audit['usage'])}`；reasoning 为 output 的组成，不重复累加；美元费用未知。

## 理解与可用性边界

任务明确要求原 Branch 再执行并给出 Branch ID；工具选择与调用步骤由模型完成，不能称无提示自主发现需求。父方实际读过 v1，再发完整修订要求；接收方读取文件并完成工作，未观察它调用 spinetree_read 获取旧 memory。因此本轮证明保留与修订，不证明接收方直接依赖旧 memory 推理。

复盘通过 spinetree_read 准确解释了 v1/v2 的来源，区分 ready、queued、delivered 和 completed。其称“没有单独 observed 字段”限于父方 read/dispatch 返回；主机检查确认 mailbox 已 observed，接收方实际调用了 observe，不能把字段缺席说成未确认消息。

复盘再次遗漏 Close，需要第 4 个输入提醒。这个问题从生命周期试验复现，交给 skill 使用与组合验证处理，未宣称已修好。

模型指出：top-level active binding 已为空、reexecution 已 completed，但 `reexecution.binding.status` 仍是 running。该嵌套记录保存分配时的 binding；实际 registry 已 ended，没有活执行泄漏。这是返回字段含义容易误解的证据，需审查展示/契约，而不能仅根据文字把历史 ownership 记录改写。

## 证据

- [完整轨迹核对](trace-audit.json)
- [初版产物检查](candidate-initial.json)
- [新版产物检查](candidate-revised.json)
- [结果及全部来源 hash](live-result.json)
- [初始、变更、复盘、收尾输入]({run}/turn-2-input.json)（其余输入在同目录 turn-1/3/4-input.json）
- [复盘回答]({run}/turn-3-answer.json)
- [最终状态]({run}/final-state.json)

本轮没有修改冻结 runtime 或生产源码。所有输入、错误和会话保留。
'''
(out / 'live-report.md').write_text(report)
for path in [task / 'memory/audit-live.py', task / 'memory/finish-live.py', task / 'memory/prepare.py']:
    ast.parse(path.read_text())
for path in [task / 'memory/dialogue.mjs', task / 'memory/verify-candidate.mjs']:
    subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
for path, digest in hashes.items():
    assert sha(Path(path)) == digest, path
for path in [out / 'live-report.md', task / 'memory/audit-live.py', task / 'memory/finish-live.py']:
    assert all(line == line.rstrip() for line in path.read_text().splitlines()), str(path)
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True, capture_output=True)
validation = {'passed': True, 'hashReferences': len(hashes), 'pythonAst': 3, 'nodeChecks': 2, 'whitespace': True, 'gitDiffCheck': True,
              'resultSha256': sha(out / 'live-result.json'), 'reportSha256': sha(out / 'live-report.md')}
(out / 'live-validation.json').write_text(json.dumps(validation, indent=2) + '\n')
print(json.dumps(validation))
