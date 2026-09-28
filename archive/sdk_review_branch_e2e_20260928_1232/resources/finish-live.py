from datetime import datetime, timezone
from pathlib import Path
import ast
import fcntl
import hashlib
import json
import re
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/resources'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/resources-spinetree-grok-20260928_1436')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
audit = json.loads((out / 'trace-audit.json').read_text())
assert audit['passed'] and audit['allAgentsEnded']
final = json.loads((run / 'final-state.json').read_text())
revised = json.loads((run / 'turn-2-state.json').read_text())
ready = json.loads((run / 'ready.json').read_text())
events = [json.loads(x) for x in (run / 'launch.log').read_text().splitlines()]
assert events[-1]['type'] == 'closed'
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
assert final['branches']['root'] == revised['branches']['root']
assert all(b['status'] == 'capped' for b in final['branches'].values() if b['id'] != 'root')
assert len(audit['publications']) == 6 and len(audit['invocations']) == 4
checks = [json.loads((out / f'candidate-{kind}.json').read_text()) for kind in ['initial', 'revised', 'local']]
for check in checks:
    assert check['passed'] and sha(Path(check['path'])) == check['sha256']
local = checks[-1]['branch']
assert local != 'root'
local_use = next(x for x in audit['invocations'] if x['source'] == local)
later = [x for x in audit['invocations'] if x['line'] > local_use['line']]
assert len(later) == 1 and later[0]['source'] == 'root' and later[0]['branch'] != local
assert later[0]['version'] == checks[1]['version']
assert local_use['output'] == {'totalMinor': 1030, 'invalid': [3]}
assert later[0]['output'] == {'totalMinor': 1200, 'invalid': [0, 1, 3]}
for use in audit['invocations']:
    assert any(s['name'] == 'check-money-batch' for s in use['declaredSkills'])
coissued = [u for u in audit['invocations'] if any(c['line'] == u['line'] and c['name'] in ['spine_open', 'spine_next', 'spine_close'] for c in audit['toolCalls'])]
assert len(coissued) == 1 and coissued[0]['version'] == checks[1]['version']
counts = {}
for call in audit['toolCalls']:
    counts[call['name']] = counts.get(call['name'], 0) + 1
assert not any(counts.get(k, 0) for k in ['spine_spawn', 'spine_child_return', 'spinetree_change', 'spinetree_rejuvenate'])
runtime_manifest = json.loads((out / 'runtime-manifest.json').read_text())
for entry in runtime_manifest['files']:
    path = task / 'runtime-resources' / entry['path']
    if 'sha256' in entry:
        assert sha(path) == entry['sha256'], str(path)
    else:
        assert str(path.readlink()) == entry['symlink'], str(path)
old = (run / 'manifest.yaml').read_bytes()
(out / 'testbed-manifest-before-finish.yaml').write_bytes(old)
manifest = yaml.safe_load(old)
manifest.update(status='stopped', pid=ready['pid'], started_at=ready['at'], ended_at=events[-1]['at'], official_benchmark=False,
                official_score=None, spawn_count=0, mailbox_used=False, mechanism_verified=True,
                autonomous_usability='Requested resource workflow and four-turn review passed without tool-order or Close correction; generalization unproven')
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
with (run / 'worklog.md').open('a') as stream:
    stream.write('\nReal Grok resource workflow complete: root v1/v2 and local same-name override, six publications, four script invocations. Three scripts each passed 6 host batches / 220 amounts. Four prompts with no Close reminder. Runtime unchanged; all sessions disposed. Ready/launch records are the run timestamps; allocation manifest remained prepared during this interactive driver and is now stopped. Evidence: ' + str(out / 'live-report.md') + '\n')
with (run.parent / 'index.tsv').open('r+') as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    before = stream.read()
    (out / 'testbed-index-before-finish.tsv').write_text(before)
    rows = before.splitlines()
    selected = [i for i, row in enumerate(rows) if run.name in row]
    assert len(selected) == 1
    fields = rows[selected[0]].split('\t')
    assert len(fields) == 9
    fields[4], fields[7], fields[8] = 'stopped', '0', 'resource publish/revise/local override passed; 3 pinned versions; SDK ac887e6'
    rows[selected[0]] = '\t'.join(fields)
    stream.seek(0); stream.write('\n'.join(rows) + '\n'); stream.truncate()
paths = [out / 'trace-audit.json', out / 'runtime-manifest.json', run / 'manifest.yaml', run / 'worklog.md', run / 'launch.log', run / 'SPEC.md', run / 'GOAL.md',
         task / 'resources/audit-live.py', task / 'resources/finish-live.py', task / 'resources/dialogue.mjs', task / 'resources/verify-candidate.mjs',
         *sorted(out.glob('candidate-*.json')), *sorted((run / 'scripts').glob('*.mjs'))]
hashes = {str(p): sha(p) for p in paths}
hashes.update(audit['hashes'])
result = {'completedAt': datetime.now(timezone.utc).isoformat(), 'mechanismPassed': True, 'realAgentWorkflowPassed': True,
          'observedUsabilityPassed': True, 'generalUsabilityEstablished': False, 'prompts': 4, 'closeReminder': False,
          'sdkCommit': ready['sdkCommit'], 'runtimeFilesVerified': len(runtime_manifest['files']), 'publications': len(audit['publications']),
          'scriptVersions': 3, 'scriptInvocations': 4, 'hostChecks': [{'revision': c['revision'], 'batches': c['batches'], 'amounts': c['amounts'], 'version': c['version'], 'sha256': c['sha256']} for c in checks],
          'rootUnchangedAfterLocalOverride': True, 'skillAssociationsRecorded': 4, 'coissuedTransitionInvocations': coissued,
          'toolCounts': counts, 'usage': audit['usage'], 'sessionsEnded': True,
          'limits': ['Task prompts explicitly requested publication, revision and a local override; the Agent chose its tool sequence.',
                     'Skill association and declared evidence do not prove causal method influence. Public calculations and independent checks support only tested behavior.',
                     'One revised call shared a sampling with Next and captured the pre-transition offer; later sibling use independently confirms root-version inheritance.',
                     'The first checker failed at session line 41 on pathToFileURL(URL); corrected check passed at line 53. Pi tool isError remained false.',
                     'The retrospective accurately left uninspected histories unknown; it could not see journaled skill associations in the plain tool response.',
                     'This Close success does not resolve earlier two omissions. No Spawn, reexecution or tree restructuring was tested here.'], 'hashes': hashes}
(out / 'live-result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
report = f'''# Branch 资源：真实 Agent 发布、修订与局部覆盖

本轮指定的资源工作流与交互核对通过。Grok 4.7 high，SDK `ac887e6`，独立 testbed `{run.name}`。不是官方 benchmark，也不证明 RSI 净收益。

## 实际闭环

| 资源 | 所有者 | 实际消费 | 主机检查 |
| --- | --- | --- | --- |
| 首版 tool + checking skill | root | 后续 Branch 用 r1 汇总新批次 | 6 批、220 个输入通过 |
| 扩展 `.50` / `12.` 的新版 | root | 精确 r2 版本被调用；后续兄弟再调用 r2 | 6 批、220 个输入通过 |
| 接受负数退款的同名覆盖 | `{local}` | 本地 r3 调用输出 1030 / [3] | 6 批、220 个输入通过 |

6 次发布全部返回 applied:true；3 个 tool descriptor 版本、3 个 skill 版本，4 次脚本资源调用。四次都在不可变 journal 中记录了 checking skill 的 name/version/source。模型在公开输出中比较预期值与实际 JSON；主机另用 BigInt 参考计算核验各版产物。发布 evidence 始终只是 declared。

退款覆盖后的兄弟 Branch `{later[0]['branch']}` 仍消费 root 的 r2，同一批 `["-.5","-1.20","12.","+1"]` 得到 1200 / [0,1,3]。从第二轮完成到最终关闭，整个 root Branch 值完全一致。r1/r2/r3 文件仍匹配各自发布 hash。

## 轨迹和边界

41 次采样与 41 份 canonical receipt、55 组工具调用结果、23 个不同 offer 均逐条核验。单 Agent，10 Branch（root 加 9 个直接子节点）；Open4 / Next5 / Close4，9 份 memory v1 逐条对齐 canonical 来源。最后回到 root，registry ended，交互进程正常退出。

有一处不能简化为“下一 Branch 选用了新版”：session 的第二次脚本调用与 Next 同批发出，resource-use 捕获的是转场前 `{coissued[0]['branch']}` 的 offer。它证明 r2 被消费；第三轮转场后单独调用的兄弟 r2 才提供新的明确继承证据。这里记录实际边界，不改写历史归属。

provider 和 Pi isError 记录均为 0，但并非没有开发失败：session 第 41 行的检查脚本误用 pathToFileURL(URL)，实际 exit 1；Agent 修正检查脚本后第 53 行通过 18 项，工具包装的 isError 不反映这类命令退出码。r2 自测 26 项，局部 r3 自测 16 项，相关原始结果全部保留。

## 交互理解

四个输入分别是初始任务、语法变更、局部退款覆盖、只读接口复盘。任务明确要求使用资源系统和局部覆盖；没有指定逐个工具调用步骤，也没有补 Close 提醒。本轮复盘自主 read 资源和兄弟分支、重算脚本 hash、Close 返回 root。

复盘正确区分 source、descriptor 版本、entry hash、branch revision 和 Git HEAD；没有把未读取的其它分支说成已经检查。它将“宿主是否记录 skill 关联”保留为未知，因为模型可见的执行结果正文没有回显该元数据；主机 journal 已独立确认四次关联。read 提供描述和 revision，而精确可执行版本来自 offer；这一认知正确。

Agent 建议 execute 回显关联及 read 带版本，但明确这是未造成失败的改进建议。未据自述直接修改接口。实际可用性证据限于本轮指定场景，不能推翻03/04已经记录的漏 Close，亦不能证明 skill 产生了因果收益。

usage：`{json.dumps(audit['usage'])}`。reasoning 包含在 output 中，不重复累计；美元成本未知。冻结 runtime 的 {len(runtime_manifest['files'])} 项文件/链接复核不变。

## 证据

- [完整轨迹核对](trace-audit.json)
- [首版检查](candidate-initial.json)、[共享新版检查](candidate-revised.json)、[局部版检查](candidate-local.json)
- [结果及来源 hash](live-result.json)
- [第4轮复盘]({run}/turn-4-answer.json)
- [最终状态]({run}/final-state.json)

本分支未修改生产源码或冻结运行时。所有会话、失败与检查结果保留。
'''
(out / 'live-report.md').write_text(report)
for path in [task / 'resources/audit-live.py', task / 'resources/finish-live.py']:
    ast.parse(path.read_text())
for path, digest in hashes.items():
    assert sha(Path(path)) == digest, path
links = re.findall(r'\]\(([^)]+)\)', report)
for target in links:
    assert (out / target).exists(), target
for path in [out / 'live-report.md', task / 'resources/audit-live.py', task / 'resources/finish-live.py']:
    assert all(line == line.rstrip() for line in path.read_text().splitlines()), str(path)
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True, capture_output=True)
validation = {'passed': True, 'hashReferences': len(hashes), 'runtimeFilesVerified': len(runtime_manifest['files']), 'pythonAst': 2,
              'links': len(links), 'whitespace': True, 'gitDiffCheck': True, 'resultSha256': sha(out / 'live-result.json'), 'reportSha256': sha(out / 'live-report.md')}
(out / 'live-validation.json').write_text(json.dumps(validation, indent=2) + '\n')
print(json.dumps(validation))
