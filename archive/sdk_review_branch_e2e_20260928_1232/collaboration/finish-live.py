"""Integrate completed collaboration evidence and register this stopped PoC.

No model, candidate test, build or runtime mutation is performed here.
"""
import ast
import collections
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
repo = task.parents[1]
out = task / 'evidence/collaboration'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612')
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
read = lambda path: json.loads(path.read_text())
write_json = lambda path, value: path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
now = datetime.now(timezone.utc).isoformat()
audit = read(out / 'trace-audit.json')
runtime = read(out / 'runtime-close-validation.json')
initial = read(out / 'candidate-initial.json')
revised = read(out / 'candidate-revised.json')
ready = read(run / 'ready.json')
final = read(run / 'final-state.json')
events = [json.loads(line) for line in (run / 'launch.log').read_text().splitlines()]
assert all(item['passed'] for item in [audit, runtime, initial, revised])
assert audit['allAgentsEnded'] and runtime['registryOwnersEnded'] == 4
assert runtime['runtimeEntriesVerified'] == 16564 and runtime['commitFilesVerified'] == 92
assert runtime['unexpectedRuntimeEntries'] == runtime['matchingNodePids'] == runtime['unreadablePids'] == []
assert runtime['originalRunnerPidAbsent'] and not Path('/proc', str(ready['pid'])).exists()
assert events[-1]['type'] == 'closed' and events[-1]['head'] == runtime['finalHead']
assert ready['sdkCommit'] == runtime['sdkCommit'] == 'eeea5d68ff1231be43206c4038f43dc2154d8ddf'
assert all(owner['status'] == 'ended' for owner in final['registry'].values())
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
assert not any(s[k] for s in audit['sessions'] for k in ['faults', 'toolErrors', 'providerErrors'])
for path, digest in audit['hashes'].items():
    assert sha(Path(path)) == digest, path
for item in runtime['references']:
    assert sha(Path(item['path'])) == item['sha256'], item['path']
for item in initial['artifacts']:
    assert sha(out / 'initial-artifacts' / item['name']) == item['sha256']
for item in revised['artifacts']:
    assert sha(run / item['name']) == item['sha256']
for item in read(out / 'initial-artifacts/manifest.json'):
    assert sha(out / 'initial-artifacts' / item['path']) == item['sha256']
assert initial['artifacts'][0] == revised['artifacts'][0]
assert initial['artifacts'][2] == revised['artifacts'][2]

turns = {i: read(run / f'turn-{i}-answer.json') for i in range(1, 5)}
turn_counts = {i: dict(collections.Counter(block['name'] for reply in value['assistants']
               for block in reply['content'] if block['type'] == 'toolCall')) for i, value in turns.items()}
assert len(turns[3]['assistants']) == 3
assert turn_counts[3] == {'read': 8, 'spinetree_read': 1, 'bash': 1}
assert turn_counts[4] == {'spine_open': 1, 'spine_close': 1}
assert read(run / 'turn-3-state.json')['registry'][ready['agentId']]['scopeCursor'] == [1]
recipient = next(s for s in audit['sessions'] if s['owner']['branch'] == audit['sameBranch']
                 and s['sessionId'] == final['branches'][audit['sameBranch']]['reexecution']['binding']['sessionId'])
assert not any(c['name'] == 'spinetree_read' and c['sessionId'] == recipient['sessionId'] for c in audit['toolCalls'])
assert len(audit['sessions']) == 4 and len(audit['toolCalls']) == 79
assert sum(s['samplings'] for s in audit['sessions']) == 46
assert sum(s['canonicalReceipts'] for s in audit['sessions']) == 46
assert len(audit['gitHeads']) == 62

interaction = {
    'reviewedAt': now, 'inputCount': 4, 'autonomousUsabilityPassed': False,
    'items': [
        {'topic': 'workflow', 'turns': [1, 2],
         'observed': 'One Spawn with two disjoint child assignments, two typed returns, parent source/test reads and 21 passing tests; later same-Branch feedback, observe, revision and 24 passing parent tests.',
         'agentSelfReport': 'Split/integrate and communicate/reexecute guidance was useful.',
         'hostInterpretation': 'The requested collaboration and feedback workflow ran successfully; the Agent selected the tool sequence.',
         'limit': 'The task explicitly requested two children and later supplied the original Branch ID. No claim of autonomous discovery or skill causality.'},
        {'topic': 'version_and_status', 'turns': [2, 3],
         'observed': 'The original Branch retains identity, parent and goal; current memory is v2, historical v1 is in reexecution.source. Replies distinguish completed state, null current binding and historical allocation status running.',
         'agentSelfReport': 'Preserved versions increased the reading burden.',
         'hostInterpretation': 'Status/version interpretation is correct in this run. The receiver did not call spinetree_read for v1.',
         'limit': 'No proof of direct receiver reasoning from old Branch memory or a causal effect of the read-contract clarification.'},
        {'topic': 'root_retrospective', 'turns': [3],
         'observed': 'Three samplings, eight read, one spinetree_read and one bash, no Open/Next/Close; root cursor stays [1].',
         'agentSelfReport': 'The later answer attributed this to confusing read-only artifacts with scope lifecycle.',
         'hostInterpretation': 'Substantive review occurred at root contrary to the configured branch policy. This was not an unclosed live branch or a process leak.',
         'limit': 'The suggested wording confusion is an unverified explanation, not an established root cause.'},
        {'topic': 'prompted_correction', 'turns': [4],
         'observed': 'An explicit factual feedback prompt was followed by one Open and one Close in three samplings.',
         'agentSelfReport': 'The Agent acknowledged the scope error and suggested clarifying read-only instructions.',
         'hostInterpretation': 'Correction succeeded after prompting; autonomous usability remains false.',
         'limit': 'Do not count this as unprompted repair or as resolution of the earlier stage03/04 omissions.'},
        {'topic': 'coordination_wording', 'turns': [3, 4],
         'observed': 'Parent decomposition, two typed returns, artifact inspection, integration and independent checks are present. One child read peer notes without changing its implementation.',
         'agentSelfReport': 'The broad no substantive collaboration wording was later narrowed to no peer mutual revisions or measured speedup.',
         'hostInterpretation': 'There is parent-child coordination; there is no observed reciprocal child knowledge update.',
         'limit': 'Overlapping child sampling intervals do not establish speedup.'},
        {'topic': 'historical_contract', 'turns': [2, 3],
         'observed': 'SPEC.md and old memories retain the nonnegative range; the explicit newer request supersedes it and the signed implementation passes checks.',
         'agentSelfReport': 'The old and new text created a reading conflict but did not block this revision.',
         'hostInterpretation': 'Historical evidence was preserved while the requested revision completed.',
         'limit': 'This explicit supersession prompt does not establish general resistance to stale instructions.'},
    ],
    'turnToolCounts': turn_counts,
    'references': [{'path': str(run / f'turn-{i}-{kind}.json'), 'sha256': sha(run / f'turn-{i}-{kind}.json')}
                   for i in range(1, 5) for kind in ['input', 'answer', 'state']],
    'followup08': ['Clarify review-only artifact constraints versus normal branch lifecycle without adding new entities.',
                   'Test read-only analysis and completion without per-turn Open/Close reminders.',
                   'Keep current versus historical contracts explicit in combined resource/memory/structure work.'],
}
for name in ['interaction-review.json', 'live-result.json', 'live-report.md', 'live-validation.json']:
    assert not (out / name).exists(), 'Refusing to overwrite existing final evidence: ' + name
write_json(out / 'interaction-review.json', interaction)

# Preserve the exact pre-registration metadata. Only this experiment's index row changes.
before = out / 'live-finish-before'
before.mkdir()
for name, path in [('manifest.yaml', run / 'manifest.yaml'), ('testbed-worklog.md', run / 'worklog.md'),
                   ('task-worklog.md', task / 'worklog.md'), ('tree.yml', task / 'tree.yml'),
                   ('07-collaboration.md', task / 'nodes/07-collaboration.md')]:
    (before / name).write_bytes(path.read_bytes())
manifest = yaml.safe_load((run / 'manifest.yaml').read_text())
assert manifest['status'] == 'running' and manifest['sdk_commit'] == ready['sdkCommit']
manifest.update(status='stopped', started_at=ready['at'], ended_at=events[-1]['at'], pid=ready['pid'],
                official_benchmark=False, official_score=None, spawn_count=1, spawned_child_count=2,
                mailbox_used=True, mechanism_verified=True, real_agent_workflow_passed=True,
                autonomous_usability_passed=False, live_result=str(out / 'live-result.json'))
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
with (run / 'worklog.md').open('a') as stream:
    stream.write('\nReal Grok 4.7 high collaboration completed: two child assignments and typed returns, parent integration, then same validation Branch v1→v2 through observed feedback. Parent suites 21→24; host checks each revision: 141 validation inputs, 7 batches, 6 non-array cases and one CLI. Third-turn root-only review required explicit correction, so autonomous usability remains false. Four owners ended; runtime and process closure verified. Non-official functional PoC; no official score. Evidence: ' + str(out / 'live-report.md') + '\n')
with (run.parent / 'index.tsv').open('r+') as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    original = stream.read()
    (before / 'index.tsv').write_text(original)
    rows = original.splitlines(keepends=True)
    chosen = [i for i, row in enumerate(rows) if row.split('\t')[5] == 'temp/testbed/' + run.name]
    assert len(chosen) == 1
    i = chosen[0]
    fields = rows[i].rstrip('\n').split('\t')
    assert len(fields) == 9 and fields[4] == 'prepared'
    fields[2], fields[4], fields[7], fields[8] = 'multi-agent-ledger-feedback', 'stopped', '1', 'two typed returns; same-B v2 feedback passed; root review corrected after prompt; SDK eeea5d68; non-official'
    rows[i] = '\t'.join(fields) + '\n'
    updated = ''.join(rows)
    assert all(a == b for j, (a, b) in enumerate(zip(original.splitlines(keepends=True), rows)) if j != i)
    stream.seek(0)
    stream.write(updated)
    stream.truncate()
    assert updated.count('temp/testbed/' + run.name + '\t') == 1
registration = {'previousManifestStatus': 'running', 'previousIndexStatus': 'prepared', 'newStatus': 'stopped',
                'startedAt': ready['at'], 'endedAt': events[-1]['at'], 'recordedAt': now,
                'indexLine': i + 1, 'otherIndexRowsUnchanged': True,
                'indexBeforeSha256': sha(before / 'index.tsv'), 'indexAfterSha256': sha(run.parent / 'index.tsv'),
                'manifestBeforeSha256': sha(before / 'manifest.yaml'), 'manifestAfterSha256': sha(run / 'manifest.yaml')}
write_json(out / 'testbed-registration.json', registration)

with (task / 'worklog.md').open('a') as stream:
    stream.write('\n07 real collaboration evidence integrated: 4 sessions, 46 real samplings/canonical receipts, 79 tool pairs, 1 Spawn/2 typed returns; parent checks 21→24 and host checks pass both revisions. Same validation B advances v1→v2 with old provenance retained; mailbox observed. All owners ended and runtime 16,564 entries unchanged. Third-turn root analysis and prompted fourth-turn correction keep autonomousUsabilityPassed=false. Testbed registered stopped; stage07 document merge remains next, followed by08. See evidence/collaboration/live-report.md.\n')
node = task / 'nodes/07-collaboration.md'
body = node.read_text()
body = re.sub(r'^last:.*$', 'last: 离线和真实协作已核；4会话46采样79工具对、同B v2反馈、16564运行项完整性及stopped登记通过；自主可用性未全过', body, flags=re.M)
body = re.sub(r'^next:.*$', 'next: 归并07阶段Gate后进入08；处理只读复盘分支纪律与旧契约辨识', body, flags=re.M)
node.write_text(body)
tree = yaml.safe_load((task / 'tree.yml').read_text())
assert tree['active'] == '07-collaboration' and tree['nodes']['07-collaboration']['status'] == 'in_progress'
tree['updated_at'] = now
(task / 'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False, allow_unicode=True))

source_paths = [out / name for name in ['trace-audit.json', 'candidate-initial.json', 'candidate-revised.json',
                'ownership-review.md', 'report-review.md', 'runtime-close-review.md', 'runtime-close-validation.json',
                'runtime-manifest-live.json', 'live-preparation.json', 'audit-live-02.log', 'audit-offer-resolution.json',
                'interaction-review.json', 'testbed-registration.json', 'initial-artifacts/manifest.json',
                'git-lock/report.md', 'git-lock/validation.json']]
source_paths += [task / 'collaboration' / name for name in ['finish-live.py', 'audit-live.py', 'verify-runtime-close.py',
                 'verify-candidate.mjs', 'dialogue.mjs', 'child-provider.mjs', 'child-preload.mjs']]
source_paths += [run / name for name in ['manifest.yaml', 'worklog.md', 'SPEC.md', 'GOAL.md', 'ledger.mjs',
                 'validation.mjs', 'aggregation.mjs', 'validation.test.mjs', 'aggregation.test.mjs', 'integration.test.mjs',
                 'shared-notes/ledger.md', 'shared-notes/validation.md', 'shared-notes/aggregation.md']]
source_paths += sorted(p for p in before.rglob('*') if p.is_file())
hashes = dict(audit['hashes'])
hashes.update({str(path): sha(path) for path in source_paths})
result = {'completedAt': now, 'mechanismPassed': True, 'realAgentWorkflowPassed': True,
          'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
          'testbed': str(run), 'sdkCommit': ready['sdkCommit'], 'model': 'grok-4.7', 'thinking': 'high',
          'officialBenchmark': False, 'officialScore': None, 'interactionPrompts': 4,
          'sessions': 4, 'samplings': 46, 'canonicalReceipts': 46, 'toolPairs': 79,
          'offers': sum(len(s['offers']) for s in audit['sessions']), 'gitHeads': len(audit['gitHeads']),
          'toolCounts': audit['toolCounts'], 'sameBranch': audit['sameBranch'], 'memoryVersions': [1, 2],
          'previousMemoryAndSourceRetained': True, 'childSamplingIntervalsOverlap': True,
          'functionalChecks': {'initial': initial, 'revised': revised},
          'agentTests': {'initialValidation': 5, 'aggregation': 7, 'initialParent': 21, 'revisedValidation': 5, 'revisedParent': 24},
          'ownershipReview': {'passed': True, 'report': str(out / 'ownership-review.md'),
                              'scope': 'Recorded 9 writes, 5 edits / 7 replacements and 13 bash calls; nine initial/final artifacts. Not syscall auditing.'},
          'runtimeClosure': runtime, 'testbedRegistration': registration, 'usage': audit['usage'], 'usd': None,
          'reasoningAccounting': 'Output includes reasoning; do not add reasoning tokens again.',
          'limits': ['Third-turn substantive review stayed at root; fourth-turn correction was explicitly prompted.',
                     'User requested the two children and same-Branch feedback; tool sequence was Agent-selected.',
                     'Receiver did not use spinetree_read to retrieve old memory; no direct memory-use or skill-causality claim.',
                     'Only adapter-owned ready reexecution messaging was exercised, not arbitrary foreign Agent messaging.',
                     'Overlapping child activity does not establish speedup; no benchmark score or matched control.',
                     'No resource publication, tree movement/archive or arbitrary branch merge/pruning was tested in this live run.'],
          'hashes': hashes}
write_json(out / 'live-result.json', result)
report = f'''# 07 真实多 Agent 协作与原 Branch 反馈

真实协作和反馈工作流通过；自主可用性尚未全部通过。第三轮实质复盘直接在 root 进行，第四轮收到明确反馈后才用 Open/Close 纠正。这个问题交给08组合验证，不能用功能通过代替分支纪律通过。

运行采用 SDK `{ready['sdkCommit']}`、Grok 4.7 high，独立 testbed `{run.name}`。这是功能 PoC，不是官方 benchmark，没有官方分数。

## 已验证的协作链

一次 Spawn 把 validation 与 aggregation 分给两个独立子 Agent，文件所有权分离，共用 `shared-notes`。两次 `spine_child_return` 的正文与父方 typed terminal、Spawn 结果和持久 handoff 一致。父方随后实际读取子方源码、测试及笔记，完成 ledger 集成，并独立运行21项测试；没有只接受子方的5项/7项测试自述。

两个初始子会话的采样时段重叠：校验10:04:41.690–10:06:07.255 UTC，汇总10:04:39.967–10:05:38.758 UTC。校验子方读到了汇总笔记，但没有据此修订实现。父方拆分、返回、检查和整合已经构成协作；尚无双向子方知识修订或并行加速证据。

第二输入给定原校验 Branch `{audit['sameBranch']}` 并要求扩展负数范围。父方自行选择 read → rejuvenate → send → dispatch；接收方实际 observe、读取和修改自己的三个文件、测试并Close；父方再次读取Branch与源码，更新自己的集成测试和笔记，运行24项测试全部通过。mailbox最终为observed。父方界面未单独回显observed，不能解释为没有确认接收。

同一Branch的UUID、parent、goal保持，memory v1→v2；v1正文、memorySource与scopeBinding保留在 `reexecution.source`，当前v2来源指向新会话。接收方未调用spinetree_read读取v1，因此不声称它直接利用旧Branch memory推理。旧SPEC和旧memory仍保留非负范围，明确的新需求在本轮成功生效。

## 功能、轨迹与终态

| 检查 | 初版 | 有符号修订版 |
| --- | ---: | ---: |
| 主机独立校验输入 | 141通过 | 141通过 |
| 主机独立汇总批次 | 7通过 | 7通过 |
| 非数组输入 | 6通过 | 6通过 |
| CLI | 1通过 | 1通过 |
| 父方实际运行测试 | 21通过 | 24通过 |

ledger和aggregation实现字节前后不变；validation SHA256由 `{initial['artifacts'][1]['sha256']}` 改为 `{revised['artifacts'][1]['sha256']}`。所有权复核逐字节重建九份初终产物，核对9次write、5次edit中的7个替换和全部13条Bash；未发现越权写入或无法解释的净变化。这是公开调用和产物审计，不是系统调用级全盘无写入证明。

全部4个真实session共46次采样、46对canonical receipt、79组工具调用/结果、15份资源offer、62个Git状态。子会话的继承前缀已从计数排除。Open/Close各4次，Spawn1次，typed return2次；rejuvenate/send/dispatch/observe各1次。公开轨迹没有provider、tool或Spine fault。

启动于 `{runtime['readyAt']}`，正常关闭于 `{runtime['closedAt']}`。四个registry owner均ended，根cursor为[1]。`{runtime['checkedAt']}` 的终态检查确认原PID不存在、没有关联Node进程；16,564运行项（16,547文件＋17内部链接）全部匹配，无额外项，92个已跟踪package文件匹配提交。testbed的manifest和唯一index行现登记stopped；其它index行未变。

usage：input 335,968，output 56,403，cacheRead 958,080，cacheWrite 0，totalTokens 1,350,451。reasoning包含在output，不重复累加；美元费用未知。

## 使用复盘与保留边界

第三轮为3次采样、8 read＋1 spinetree_read＋1 bash，0 Open/Next/Close，在root做实质分析。第四轮的输入明确给出事实并要求正常生命周期，随后Open/Close各1次。这是提示后纠正，不是自主修复，也不是已开分支漏Close或运行泄漏。模型把原因归于“只读、不改历史”的措辞；这里只把它作为待验证解释。

本轮正确区分current binding null、reexecution completed和历史allocation中的running；不能因此推断说明修改的因果效果。三项继承skill始终同版，行为与指导吻合，不证明skill必要性、收益或版本演化。关于“无实质协同”的过宽措辞经反馈收窄；没有把看不见某条当前投影记录当作从未发生。

本轮没有测试资源发布、项目parent移动/归档、任意持久图合并或canonical裁切；消息能力限于adapter拥有的ready再执行会话。

## 失败留痕与证据

此前离线真实多进程运行出现Git HEAD.lock竞争，修复已提交eeea5d68；合成锁回归和随后离线协作通过。这不是本次真实模型运行的新fault。首次live审计因误把再执行Close后的RootEpoch assignment floor与保留的Task scopeBinding等同而失败；修正检查器后通过，冻结runtime未改。旧日志和脚本均保留。

- [全部轨迹与来源](trace-audit.json)
- [文件所有权及原始工具行](ownership-review.md)
- [初版独立功能检查](candidate-initial.json) / [修订版检查](candidate-revised.json)
- [交互事实、自述与解释分列](interaction-review.json)
- [终态运行包和进程核验](runtime-close-validation.json)
- [testbed登记前后记录](testbed-registration.json)
- [Git锁修复与离线证据](git-lock/report.md)
- [审计假设修正](audit-offer-resolution.json)
- [结构化结果与来源hash](live-result.json)
- [最终证据验证](live-validation.json)
'''
(out / 'live-report.md').write_text(report)

# Read back all writes and validate only evidence/docs; do not repeat functional tests.
assert yaml.safe_load((run / 'manifest.yaml').read_text())['status'] == 'stopped'
assert read(out / 'live-result.json')['autonomousUsabilityPassed'] is False
for path, digest in hashes.items():
    assert sha(Path(path)) == digest, path
for filename in ['finish-live.py', 'audit-live.py', 'verify-runtime-close.py']:
    ast.parse((task / 'collaboration' / filename).read_text())
for filename in ['dialogue.mjs', 'child-provider.mjs', 'child-preload.mjs', 'verify-candidate.mjs']:
    subprocess.run(['node', '--check', str(task / 'collaboration' / filename)], check=True, capture_output=True)
text_paths = [out / 'live-report.md', task / 'collaboration/finish-live.py', node, task / 'tree.yml']
for path in text_paths:
    assert all(line == line.rstrip() for line in path.read_text().splitlines()), str(path)
# The validation link is about to be written; all other local report links must exist now.
links = re.findall(r'\[[^\]]+\]\(([^)]+)\)', report)
for target in links:
    assert target == 'live-validation.json' or (out / target).is_file(), target
subprocess.run(['git', 'diff', '--check'], cwd=repo, check=True, capture_output=True)
validation = {'passed': True, 'completedAt': datetime.now(timezone.utc).isoformat(),
              'command': 'python3 -B collaboration/finish-live.py', 'hashReferences': len(hashes),
              'runtimeEntriesVerifiedBy': str(out / 'runtime-close-validation.json'), 'runtimeEntriesVerified': 16564,
              'ownershipReview': str(out / 'ownership-review.md'), 'otherIndexRowsUnchanged': True,
              'pythonAst': 3, 'nodeChecks': 4, 'reportLinks': len(links), 'whitespace': True, 'gitDiffCheck': True,
              'resultSha256': sha(out / 'live-result.json'), 'reportSha256': sha(out / 'live-report.md'),
              'interactionSha256': sha(out / 'interaction-review.json'),
              'runtimeValidationSha256': sha(out / 'runtime-close-validation.json'),
              'ownershipReviewSha256': sha(out / 'ownership-review.md')}
write_json(out / 'live-validation.json', validation)
assert (out / 'live-validation.json').is_file()
print(json.dumps(validation, ensure_ascii=False))
