"""Integrate the completed independent reviews; no model/build/test reruns."""
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
out = task / 'evidence/composition'
run = Path('/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024')
unused = run.with_name('composition-spinetree-grok-20260928_1929')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text())
def write(p, value):
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

stamp = datetime.now(timezone.utc).isoformat()
reports = [out / 'trajectory-review.md', out / 'runtime-review.md']
sources = {}
for report in reports:
    # Only hash public evidence bytes; never parse assistant thinking.
    matches = re.findall(r'\| \[[^\]]+\]\((/[^)]+)\) \| `([a-f0-9]{64})` \|', report.read_text())
    assert matches, report
    for path, digest in matches:
        assert sha(Path(path)) == digest, path
        sources[path] = digest
    sources[str(report)] = sha(report)
runtime = json.loads(re.search(r'```json\n(.*?)\n```', reports[1].read_text(), re.S)[1])
assert runtime['runtimeIntegrityPassed'] and runtime['candidatePassed'] and runtime['terminalStatePassed']
assert runtime['runtimeEntries'] == 16564 and runtime['listedPackageBlobsChecked'] == 92
closed = read(out / 'interaction-session-closed.json')
assert closed['runnerExitCode'] == 0 and closed['head'] == runtime['gitHead']
for ref in closed['references']:
    assert sha(Path(ref['path'])) == ref['sha256']
    sources[ref['path']] = ref['sha256']
assert read(out / 'offline-result.json')['passed']
ready, final = read(run / 'ready.json'), read(run / 'final-state.json')
assert ready['sdkCommit'] == runtime['sdkCommit']
assert len(final['registry']) == 6 and all(o['status'] == 'ended' for o in final['registry'].values())
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
assert not Path('/proc', str(ready['pid'])).exists()
assert not list(unused.rglob('turn-*-input.json')) and not list(unused.rglob('*.jsonl'))
for folder in Path('/proc').iterdir():
    if not folder.name.isdigit():
        continue
    try:
        argv = (folder / 'cmdline').read_bytes().split(b'\0')
    except (FileNotFoundError, ProcessLookupError):
        continue
    if argv and Path(argv[0].decode(errors='replace')).name in ['node', 'nodejs', 'pi']:
        assert not any(str(p).encode() in arg for p in [run, unused, task / 'composition/dialogue.mjs'] for arg in argv)

turns = {i: read(run / f'turn-{i}-answer.json') for i in range(1, 5)}
counts = {i: dict(collections.Counter(b['name'] for a in t['assistants'] for b in a['content'] if b['type'] == 'toolCall')) for i, t in turns.items()}
assert [len(t['assistants']) for t in turns.values()] == [11, 5, 35, 4]
assert counts[4] == {'spine_open': 1, 'spinetree_read': 3, 'read': 2, 'spine_close': 1}
assert len(final['branches']) == 12
assert collections.Counter(b['status'] for b in final['branches'].values()) == {'live': 1, 'capped': 10, 'archived': 1}
for name in ['interaction-review.json', 'live-result.json', 'live-report.md', 'live-validation.json']:
    assert not (out / name).exists(), name

interaction = {
    'reviewedAt': stamp, 'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
    'turnSamplings': [11, 5, 35, 4], 'turnToolCounts': counts,
    'items': [
        {'turns': [1, 2], 'observed': 'Two premature finals at non-root cursors; claims of candidate equivalence and parent integration preceded the actual module/integration writes.', 'verdict': 'Failed autonomous completion and inaccurate completion claims; continued after generic host prompts.'},
        {'turns': [2], 'observed': 'Next and Spawn in one sampling were rejected; standalone Spawn then succeeded.', 'verdict': 'Expected incompatible-transition rejection; model tool selection error.'},
        {'turns': [3], 'observed': 'Same validation Branch advanced v1 to v2; recipient actually read its v1 via spinetree_read and observed feedback before allowed edits. Explicit current signed requirement superseded old unsigned evidence.', 'verdict': 'Workflow passed; retrieval does not establish causal memory benefit or general resistance to stale instructions.'},
        {'turns': [3], 'observed': 'Root tool revised, local cap-100 override and sibling inheritance exercised; old check-ledger skill evidence stayed unsigned. Validation Branch moved/archived, then later obligations and Spawn completed.', 'verdict': 'Mechanisms passed; resource-use association does not prove skill adherence. Archive retained history, not pruning or merge.'},
        {'turns': [3], 'observed': 'Recipient note-format AssertionError was not repaired; its later module suite passed. Three direct checker subprocess probes failed from argv mismatch; later host-convention probes succeeded.', 'verdict': 'Preserve nested failures even when outer Bash/tool status is successful.'},
        {'turns': [4], 'observed': 'Without another Close reminder, read-only review used Open/Close, three Tree reads and two file reads.', 'verdict': 'Scope discipline passed this interview; experimental seed wording cannot establish causality or erase earlier failures.'},
        {'turns': [4], 'observed': 'Answer correctly separated current binding null, completed operation and historical running allocation; incorrectly claimed a project-parent read, four extra note reads and broadly said child checks were not rerun by parent.', 'verdict': 'Fact reporting failed: actual third Tree read was self-review; parent earlier ran all three suites twice, each 20/20. No tests were rerun in prompt 4.'},
    ],
    'sourceReports': [str(p) for p in reports],
    'followup': ['Completion claims must match durable artifacts and checks.', 'Fresh-read claims must match actual tool reads; inherited memory is a separate source.', 'Historical skill evidence should be identified as historical when current tool behavior changes.'],
}
write(out / 'interaction-review.json', interaction)

before = out / 'live-finish-before'
before.mkdir()
for bed in [run, unused]:
    folder = before / bed.name
    folder.mkdir()
    for name in ['manifest.yaml', 'worklog.md']:
        (folder / name).write_bytes((bed / name).read_bytes())

manifest = yaml.safe_load((run / 'manifest.yaml').read_text())
assert manifest['status'] == 'running'
manifest.update(status='stopped', ended_at=closed['closedAt'], official_benchmark=False,
                official_score=None, spawn_count=2, spawned_child_count=4, mailbox_used=True,
                mechanism_verified=True, real_agent_workflow_passed=True, autonomous_usability_passed=False,
                live_result=str(out / 'live-result.json'))
(run / 'manifest.yaml').write_text(yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True))
old = yaml.safe_load((unused / 'manifest.yaml').read_text())
assert old['status'] == 'prepared' and old['pid'] is None and old['started_at'] is None
old.update(status='stopped', ended_at=None, official_benchmark=False, official_score=None,
           model_requests=0, stop_reason='Abandoned offline fixture preparation attempt; no real Agent launched. Exact abandonment time unavailable.', registration_updated_at=stamp)
(unused / 'manifest.yaml').write_text(yaml.safe_dump(old, sort_keys=False, allow_unicode=True))
for bed, note in [(run, 'Completed combined workflow after two continuation prompts; autonomous usability false. Six owners ended; two Spawn batches/four typed returns, observed mail, archived v2 retained. Non-official functional PoC.'),
                  (unused, 'Registered stopped: abandoned preparation/offline attempt, no real Agent launch or prompt file. Exact abandonment time is unknown. Earlier directory-collision diagnosis is inherited history; this registration does not reconstruct its missing command log.')]:
    with (bed / 'worklog.md').open('a') as f:
        f.write('\n' + stamp + ' — ' + note + '\nEvidence: ' + str(out / 'live-report.md') + '\n')
with (run.parent / 'index.tsv').open('r+') as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    original = f.read()
    (before / 'index.tsv').write_text(original)
    rows = original.splitlines(keepends=True)
    changed = []
    for bed, spawn, note in [(run, '2', 'Combined workflow completed after prompts; autonomous false; six ended; non-official'), (unused, '0', 'Abandoned preparation/offline attempt; no model; exact stop time unknown')]:
        chosen = [i for i, row in enumerate(rows) if len(row.split('\t')) == 9 and row.split('\t')[5] == 'temp/testbed/' + bed.name]
        assert len(chosen) == 1
        i = chosen[0]
        fields = rows[i].rstrip('\n').split('\t')
        assert fields[4] == 'prepared'
        fields[4], fields[7], fields[8] = 'stopped', spawn, note
        rows[i] = '\t'.join(fields) + '\n'
        changed.append(i)
    assert all(a == b for i, (a, b) in enumerate(zip(original.splitlines(keepends=True), rows)) if i not in changed)
    f.seek(0)
    f.write(''.join(rows))
    f.truncate()

# Retain report-era metadata hashes through explicit before paths.
relocations = {str(run.parent / 'index.tsv'): str(before / 'index.tsv')}
for bed in [run, unused]:
    for name in ['manifest.yaml', 'worklog.md']:
        relocations[str(bed / name)] = str(before / bed.name / name)
for original, backup in relocations.items():
    if original in sources:
        assert sha(Path(backup)) == sources[original]
        sources[backup] = sources.pop(original)
registration = {'recordedAt': stamp, 'newStatus': 'stopped', 'changedIndexLines': [i + 1 for i in changed],
                'otherIndexRowsUnchanged': True, 'startedAt': manifest['started_at'], 'endedAt': closed['closedAt'],
                'abandonedAttemptEndedAt': None, 'reportEraMetadataRelocations': relocations,
                'beforeHashes': {str(p): sha(p) for p in before.rglob('*') if p.is_file()},
                'afterHashes': {str(p): sha(p) for p in [run / 'manifest.yaml', run / 'worklog.md', unused / 'manifest.yaml', unused / 'worklog.md', run.parent / 'index.tsv']}}
write(out / 'testbed-registration.json', registration)

additional = [out / n for n in ['interaction-review.json', 'testbed-registration.json', 'live-preparation.json', 'offline-result.json', 'entry-fix/result.json']]
additional += [p for p in (task / 'composition').iterdir() if p.suffix in ['.py', '.mjs']]
additional += [run / 'manifest.yaml', unused / 'manifest.yaml', run / 'worklog.md', unused / 'worklog.md']
sources.update({str(p): sha(p) for p in additional})
result = {
    'completedAt': stamp, 'mechanismPassed': True, 'realAgentWorkflowPassed': True,
    'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
    'testbed': str(run), 'sdkCommit': runtime['sdkCommit'], 'model': 'grok-4.7', 'thinking': 'high',
    'officialBenchmark': False, 'officialScore': None, 'interactionPrompts': 4,
    'sessions': 6, 'samplings': 86, 'canonicalReceipts': 86, 'toolPairs': 160, 'offers': 26, 'gitHeads': 114,
    'successfulSpawnBatches': 2, 'typedReturns': 4, 'rejectedSpawnCalls': 1,
    'resourceUseJournals': 25, 'publications': 4, 'checkerInvocations': 21,
    'sameBranch': 'b3dbd052-5fa9-4428-a0c6-778c178fa00c', 'memoryVersionBefore': 1, 'memoryVersionAfter': 2,
    'oldMemorySourcePreserved': True, 'recipientReadOldMemory': True, 'mailObserved': True,
    'movedAndArchivedBranchRetained': True, 'continuedAfterArchive': True,
    'parentTests': {'runs': 2, 'passedPerRun': 20, 'source': str(reports[0]), 'rerunDuringFinalInterview': False},
    'ownership': {'artifactCount': 19, 'writes': 19, 'edits': 4, 'historicalCopies': 2, 'bashReviewed': 34, 'unexplainedNetChanges': 0, 'systemCallAudit': False},
    'recordedFailures': ['Two premature finals and premature completion claims', 'One incompatible Next+Spawn rejection', 'One unrepaired note-format assertion, followed by a passing module suite', 'Three failed direct checker argv probes, later corrected', 'Final interview read-list and parent-verification misstatements'],
    'runtimeClosure': runtime, 'testbedRegistration': registration,
    'limitations': ['The offline fixtures have independent trees; only the real run composes features in one task.', 'Skill association and experimental seed changes do not establish causality.', 'Activity overlap does not establish speedup.', 'Archive is not deletion, merge or canonical pruning.', 'Runtime manifest retains its collaboration root; integrity review explicitly rebases it to runtime-composition.', 'No general autonomous usability, arbitrary bus or official benchmark claim.'],
    'hashes': sources,
}
write(out / 'live-result.json', result)
report = f'''# 08 组合真实 Agent 结果

组合工作流最终完成，独立候选检查通过；自主可用性未通过。首两轮提前结束并作出早于实际产物的完成声明，主机两次要求继续后才完成。最终只读复盘自主 Open/Close，但仍误述读取对象和父方验证。

## 输入与结果

- SDK `{runtime['sdkCommit']}`，Grok 4.7 high，独立 testbed `{run.name}`，四次交互。
- 六会话，86 次采样及 canonical receipt，160 组工具调用，26 次 offer，114 个 Git HEAD；无 provider error 或 spine fault。一项 Pi 工具错误是 Next+Spawn 组合被拒绝。
- 两次成功 Spawn、四份 typed return；父方两次执行全部三个测试文件，各 20/20 通过。
- 同校验 Branch memory v1→v2，旧正文和来源保留，接收方确实读回 v1 并观察 mailbox。身份不变；随后 move/archive 后继续工作，归档项保持不变。
- 根 checker unsigned→signed，局部 cap-100 覆盖及兄弟继承成立；25 次资源 journal 中 4 次发布、21 次执行。旧 skill 的 unsigned 证据仍保留。
- 主机 signed 候选检查：141 输入、7 批次、6 非数组边界、1 CLI，通过。三个模块 hash 见 runtime 报告。
- 19 份产物由记录的写入、编辑和两次历史复制逐字节重建，未见越权或无法解释的净变化；不是系统调用审计。
- runtime 16,564 项无漂移，92 个 package blobs 等于 SDK commit。六 owner ended、root cursor `[1]`，终态等于 Git HEAD `{runtime['gitHead']}`，本轮进程已退出。

## 未通过项和结论边界

两次提前 final、一次 Next+Spawn 拒绝、三次 checker argv 探测失败、一次未修复的笔记格式断言失败全部保留。笔记断言之后的模块测试通过，不能据外层 Bash 成功把内部失败抹掉。

第四轮实际读 archived validation、local checker 和自身 review Branch，以及两个笔记文件；回答误称读了项目 parent 和另外四份笔记。它对“父方没有重跑”的概括也不准确：父方此前两次 20/20 并有独立直接调用，第四轮本身没有重跑。

当前 binding null、completed reexecution 与历史 allocation running 的区分正确。本轮自主关闭复盘不代表此前漏 Close、root 复盘或提前结束问题已解决。实验 seed 提示变更只属于本轮，不是生产修复或因果证明。

机制/最终工作流通过；`autonomousUsabilityPassed=false`，`generalUsabilityEstablished=false`。不宣称 skill 因果收益、并行加速、任意通信、merge/prune 或官方 benchmark 成绩。

## 证据与登记

- [轨迹及所有权]({reports[0]})：原始事件、逐项来源和失败定位。
- [runtime 与候选核验]({reports[1]})：完整性、候选命令及终态；其中登记状态是修正前快照。
- [交互评估]({out / 'interaction-review.json'})；[机器结果]({out / 'live-result.json'})；[离线结果]({out / 'offline-result.json'})。
- [登记前后对照]({out / 'testbed-registration.json'})：2024 从 running/prepared 改 stopped；1929 为放弃的无模型入口，精确停止时间未知，保留 null。其它 index 行不变。1943/1950/2018 的无模型入口记录仍保留。

没有新增生产修改、模型请求或产品测试。本次仅整合已通过的独立核验。09 负责最终分项覆盖矩阵、未解决项和精简提交。
'''
(out / 'live-report.md').write_text(report)
for path, digest in sources.items():
    assert sha(Path(path)) == digest, path
links = re.findall(r'\]\((/[^)]+)\)', report)
assert all(Path(p).exists() for p in links)
scripts = sorted((task / 'composition').glob('*.py'))
for p in scripts:
    ast.parse(p.read_text())
for p in [out / 'live-report.md', Path(__file__)]:
    assert all(s == s.rstrip() for s in p.read_text().splitlines())
subprocess.run(['git', 'diff', '--check'], cwd=repo, capture_output=True, check=True)
validation = {'passed': True, 'checkedAt': stamp, 'sourceHashesChecked': len(sources),
              'resultSha256': sha(out / 'live-result.json'), 'reportSha256': sha(out / 'live-report.md'),
              'sources': sources, 'linksChecked': len(links), 'pythonAstChecked': len(scripts),
              'runtimeIntegrityEvidence': str(reports[1]), 'runtimeRehashedInThisIntegration': False,
              'modelsOrTestsRerun': False, 'whitespace': True, 'gitDiffCheck': True}
write(out / 'live-validation.json', validation)
assert read(out / 'live-validation.json')['resultSha256'] == sha(out / 'live-result.json')
print(json.dumps({'passed': True, 'sources': len(sources), 'links': len(links), 'autonomousUsabilityPassed': False}))
