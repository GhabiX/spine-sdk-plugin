"""Close stage07's validation obligation and hand its usability gaps to stage08."""
from datetime import datetime, timezone
from pathlib import Path
import ast
import hashlib
import json
import subprocess
import yaml

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/collaboration'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
sources = [out / name for name in [
    'git-lock/validation.json', 'live-result.json', 'live-validation.json',
    'live-report.md', 'interaction-review.json', 'runtime-close-validation.json',
    'ownership-review.md',
]]
source_hashes = {str(path): sha(path) for path in sources}
live = json.loads((out / 'live-result.json').read_text())
validation = json.loads((out / 'live-validation.json').read_text())
assert validation['passed']
assert validation['resultSha256'] == sha(out / 'live-result.json')
assert validation['reportSha256'] == sha(out / 'live-report.md')
assert live['mechanismPassed'] and live['realAgentWorkflowPassed']
assert live['autonomousUsabilityPassed'] is False
assert live['generalUsabilityEstablished'] is False
assert live['runtimeClosure']['registryOwnersEnded'] == 4
assert live['testbedRegistration']['newStatus'] == 'stopped'
assert json.loads((out / 'git-lock/validation.json').read_text())['passed']
tree_path = task / 'tree.yml'
tree = yaml.safe_load(tree_path.read_text())
assert tree['active'] == '07-collaboration'
assert tree['nodes']['07-collaboration']['status'] == 'in_progress'
assert tree['nodes']['08-composition']['status'] == 'pending'
assert tree['nodes']['09-completion']['status'] == 'pending'
documents = [tree_path, task / 'nodes/07-collaboration.md', task / 'nodes/08-composition.md', task / 'worklog.md']
backup = out / 'stage-before'
backup.mkdir()
for path in documents:
    target = backup / path.relative_to(task)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(path.read_bytes())

stamp = datetime.now(timezone.utc).isoformat()
tree['updated_at'] = stamp
tree['active'] = '08-composition'
tree['nodes']['07-collaboration']['status'] = 'done'
tree['nodes']['08-composition']['status'] = 'ready'
tree_path.write_text(yaml.safe_dump(tree, sort_keys=False, allow_unicode=True))
p = task / 'nodes/07-collaboration.md'
text = p.read_text().replace('status: in_progress', 'status: done')
text = text.replace('next: 归并07阶段Gate后进入08；处理只读复盘分支纪律与旧契约辨识',
                    'next: 08组合；澄清只读产物与分支生命周期，独立验证无逐轮提醒的复盘和收尾')
text = text.replace('- ../evidence/collaboration/git-lock/validation.json',
                    '- ../evidence/collaboration/git-lock/validation.json\n'
                    '- ../evidence/collaboration/live-report.md\n'
                    '- ../evidence/collaboration/live-result.json\n'
                    '- ../evidence/collaboration/live-validation.json\n'
                    '- ../evidence/collaboration/interaction-review.json\n'
                    '- ../evidence/collaboration/stage-completion.json')
text = text.replace('- verification: offline passed; real-Agent workflow and interview pending',
                    '- verification: 验证义务完成；离线/真实协作通过，自主可用性未全过，明确移交08')
p.write_text(text)
p = task / 'nodes/08-composition.md'
text = p.read_text().replace('status: pending', 'status: ready')
text = text.replace('last: 保存现有变更基线',
                    'last: 03–07分项验证已归并；当前SDK eeea5d68，真实协作机制通过但自主分支纪律未全过')
text = text.replace('next: 等待依赖节点完成后细化',
                    'next: 先审查最小指导改进，再冻结独立组合任务；检验资源/旧memory/结构/协作及只读复盘')
text = text.replace('- 当前节点完成后记录证据及提交范围。',
                    '- 承接03/04漏Close与07根上复盘；区别只读产物要求和正常分支生命周期，不靠每轮提醒通过。\n'
                    '- 组合检验当前/历史契约、同Branch memory、版本化资源、结构与协作；不得宣称任意merge/prune或因果收益。\n'
                    '- 当前节点完成后记录证据及提交范围。')
text = text.replace('- ../evidence/baseline.json',
                    '- ../evidence/collaboration/live-report.md\n'
                    '- ../evidence/collaboration/interaction-review.json\n'
                    '- ../evidence/collaboration/stage-completion.json')
p.write_text(text)
with (task / 'worklog.md').open('a') as stream:
    stream.write(f'\n## {stamp} — 07阶段归并\n\n'
                 '离线与真实协作验证义务完成，07 done、08 ready。真实4会话46采样/receipt、79工具对，'
                 '一Spawn两typed return及同B v1→v2反馈通过，四owner ended，16,564运行项无漂移，testbed stopped。'
                 '第三轮只读复盘在root执行，第四轮明确提示后才Open/Close；自主及通用可用性未建立。'
                 '08必须澄清只读产物约束与分支生命周期，并在独立组合任务中验证无逐轮提醒的复盘/收尾、'
                 '当前与历史契约辨识。不得把同版skill关联、子会话重叠或持久memory视为因果收益。'
                 '本阶段后半无生产修改，不重复模型/测试，不新增源码提交；最终保留精简任务脚本与报告，排除runtime/testbed/raw sessions。\n')

for path in sources:
    assert sha(path) == source_hashes[str(path)]
loaded = yaml.safe_load(tree_path.read_text())
assert loaded['active'] == '08-composition'
assert loaded['nodes']['07-collaboration']['status'] == 'done'
assert loaded['nodes']['08-composition']['status'] == 'ready'
assert loaded['nodes']['09-completion']['status'] == 'pending'
assert sum(n['status'] == 'in_progress' for n in loaded['nodes'].values()) == 0
for path in documents:
    assert all(line == line.rstrip() for line in path.read_text().splitlines())
ast.parse(Path(__file__).read_text())
subprocess.run(['git', 'diff', '--check'], cwd=task.parents[1], check=True, capture_output=True)
result = {'passed': True, 'completedAt': stamp, 'stageObligationCompleted': True,
          'mechanismPassed': True, 'realAgentWorkflowPassed': True,
          'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
          'followup': ['08-composition', '09-completion'],
          'sourceHashes': source_hashes,
          'documentHashes': {str(path): sha(path) for path in documents},
          'backups': str(backup), 'scriptSha256': sha(Path(__file__)),
          'newSourceCommitRequired': False, 'whitespace': True, 'gitDiffCheck': True}
(out / 'stage-completion.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
readback = json.loads((out / 'stage-completion.json').read_text())
for name in ['sourceHashes', 'documentHashes']:
    for path, digest in readback[name].items():
        assert sha(Path(path)) == digest
print(json.dumps({'passed': True, 'sources': len(sources), 'documents': len(documents), 'next': loaded['active']}))
