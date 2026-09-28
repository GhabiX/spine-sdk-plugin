"""Record stage08's completed verification obligation and hand off to stage09."""
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/composition'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text())
sources = [out / n for n in ['offline-result.json', 'live-result.json', 'live-report.md',
           'live-validation.json', 'interaction-review.json', 'trajectory-review.md',
           'runtime-review.md', 'testbed-registration.json', 'interaction-session-closed.json']]
hashes = {str(p): sha(p) for p in sources}
live, validation = read(out / 'live-result.json'), read(out / 'live-validation.json')
assert validation['passed']
assert validation['resultSha256'] == sha(out / 'live-result.json')
assert validation['reportSha256'] == sha(out / 'live-report.md')
for p, digest in validation['sources'].items():
    assert sha(Path(p)) == digest, p
assert live['mechanismPassed'] and live['realAgentWorkflowPassed']
assert live['autonomousUsabilityPassed'] is False and live['generalUsabilityEstablished'] is False
assert live['runtimeClosure']['registryOwnersEnded'] == 6
assert live['testbedRegistration']['newStatus'] == 'stopped'
assert read(out / 'offline-result.json')['passed']
assert read(out / 'interaction-session-closed.json')['runnerExitCode'] == 0
registration = read(out / 'testbed-registration.json')
for p, digest in registration['beforeHashes'].items():
    assert sha(Path(p)) == digest
for p, digest in registration['afterHashes'].items():
    assert sha(Path(p)) == digest

tree_path = task / 'tree.yml'
tree = yaml.safe_load(tree_path.read_text())
assert tree['active'] == '08-composition'
assert tree['nodes']['08-composition']['status'] == 'in_progress'
assert tree['nodes']['09-completion']['status'] == 'pending'
assert all(v['status'] == 'done' for k, v in tree['nodes'].items() if k[:2] in ['01', '02', '03', '04', '05', '06', '07'])
docs = [tree_path, task / 'nodes/08-composition.md', task / 'nodes/09-completion.md', task / 'worklog.md']
before = out / 'stage-before'
before.mkdir()
for p in docs:
    target = before / p.relative_to(task)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(p.read_bytes())
stamp = datetime.now(timezone.utc).isoformat()
tree['updated_at'] = stamp
tree['active'] = '09-completion'
tree['nodes']['08-composition']['status'] = 'done'
tree['nodes']['09-completion']['status'] = 'ready'
tree_path.write_text(yaml.safe_dump(tree, sort_keys=False, allow_unicode=True))

p = task / 'nodes/08-composition.md'
body = p.read_text()
body = re.sub(r'^status:.*$', 'status: done', body, flags=re.M)
body = re.sub(r'^last:.*$', 'last: 离线与真实组合及独立审计完成；6会话86采样160工具对、141输入检查、16564运行项和stopped登记通过；自主可用性false', body, flags=re.M)
body = re.sub(r'^next:.*$', 'next: 09归并覆盖矩阵、可用性缺口和精简证据提交；不得把done理解为所有行为均通过', body, flags=re.M)
body = body.split('## Evidence')[0] + '''## Evidence

- ../evidence/composition/offline-result.json
- ../evidence/composition/live-report.md
- ../evidence/composition/live-result.json
- ../evidence/composition/live-validation.json
- ../evidence/composition/interaction-review.json
- ../evidence/composition/trajectory-review.md
- ../evidence/composition/runtime-review.md
- ../evidence/composition/testbed-registration.json
- ../evidence/composition/stage-completion.json

## Gate

- verification: 验证义务完成；离线/最终真实工作流通过，自主及通用可用性未建立，提前final与事实误述作为未解决项归并09
- commit: 本阶段无生产修改；SDK基线eeea5d68，精简实验脚本与报告纳入09证据提交
- include: composition脚本、报告、结果、验证记录及阶段文档
- exclude: runtime、testbed、raw sessions、缓存、凭据及无关历史资料
'''
p.write_text(body)
p = task / 'nodes/09-completion.md'
body = p.read_text()
body = re.sub(r'^status:.*$', 'status: ready', body, flags=re.M)
body = re.sub(r'^last:.*$', 'last: 01–08验证义务完成；源码已分阶段提交，组合机制通过但自主可用性false', body, flags=re.M)
body = re.sub(r'^next:.*$', 'next: 汇总逐点覆盖及未解决项，核对最终仓库/证据状态，选择精简提交范围并完成最终交付', body, flags=re.M)
body = body.replace('- 明确输入、状态变化和验收结果；先机制验证，再真实 Agent 使用与交互复盘。',
'''- 从03–08阶段证据形成逐点覆盖矩阵，区分机制、真实工作流、自主可用性和未支持语义。
- 保留03/04漏Close、07根上复盘、08提前final与复盘误述；最终成功不抹掉失败。
- 核对源码commit、已有验证和本地安装范围；不重复已通过且未变更的产品测试。
- 只提交可审阅的脚本、报告、结果及来源索引，排除runtime/testbed/raw sessions/凭据。''')
body = body.replace('- ../evidence/baseline.json', '- ../evidence/composition/live-report.md\n- ../evidence/composition/stage-completion.json')
p.write_text(body)
with (task / 'worklog.md').open('a') as f:
    f.write(f'\n## {stamp} — 08阶段归并\n\n'
            '离线及真实组合验证义务完成，08 done、09 ready。六会话86采样/receipt、160工具对，'
            '两成功Spawn/四typed return、同B v1→v2及实际旧memory读回、mail observed、资源版本/覆盖、move/archive后继续均核实。'
            '父测试两次20/20，主机141输入/7批/6非数组/CLI通过；16564运行项无漂移、六owner ended。'
            '保留两次提前final、Next+Spawn拒绝、未修笔记断言、三次checker argv探测失败及最终复盘误述。'
            '第四轮自主Open/Close不证明前述可用性问题已修好；autonomousUsabilityPassed=false。'
            '2024及1929登记stopped，旧入口原样保留；1929精确停止时刻未知。'
            '本轮收口仅新增任务脚本与证据，无生产修改、模型调用或测试重跑。下一09归并覆盖矩阵、缺口与精简提交。\n')

loaded = yaml.safe_load(tree_path.read_text())
assert loaded['active'] == '09-completion'
assert loaded['nodes']['08-composition']['status'] == 'done' and loaded['nodes']['09-completion']['status'] == 'ready'
assert not any(v['status'] == 'in_progress' for v in loaded['nodes'].values())
for p in docs:
    assert all(s == s.rstrip() for s in p.read_text().splitlines())
for p in docs[1:3]:
    assert re.findall(r'^## (.+)$', p.read_text(), re.M) == ['Intent', 'Plan', 'State', 'Evidence', 'Gate']
for p, digest in hashes.items():
    assert sha(Path(p)) == digest
ast.parse(Path(__file__).read_text())
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True, capture_output=True)
result = {'passed': True, 'completedAt': stamp, 'stageObligationCompleted': True,
          'mechanismPassed': True, 'realAgentWorkflowPassed': True,
          'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
          'followup': ['09-completion'], 'sourceHashes': hashes,
          'liveSourceHashesVerified': len(validation['sources']),
          'documentHashes': {str(p): sha(p) for p in docs}, 'backups': str(before),
          'scriptSha256': sha(Path(__file__)), 'newSourceCommitRequired': False,
          'whitespace': True, 'gitDiffCheck': True, 'nodeSectionsVerified': True}
(out / 'stage-completion.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'passed': True, 'sources': len(hashes), 'liveSources': len(validation['sources']), 'documents': len(docs), 'next': loaded['active']}))
