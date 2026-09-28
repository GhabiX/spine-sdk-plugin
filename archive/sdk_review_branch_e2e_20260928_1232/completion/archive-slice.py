"""Finalize and stage the reviewed evidence slice; commit remains a separate step.

Preserve all raw inputs locally and keep the historical task path reachable.
"""
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import yaml

task = Path(__file__).absolute().parents[1]
repo = task.parents[1]
out = task / 'evidence/completion'
archive = repo / 'archive' / task.name
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text())
def write(p, value):
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode().strip()

assert task.parent.name == 'tasks' and not task.is_symlink() and not archive.exists()
assert not git('ls-files', str(task.relative_to(repo)))
assert not git('diff', '--cached', '--name-only')
assert not git('status', '--short', '--untracked-files=no')
source_commit = git('rev-parse', 'HEAD')
assert source_commit == 'eeea5d68ff1231be43206c4038f43dc2154d8ddf'
candidate = read(out / 'candidate-slice.json')
assert candidate['passed'] and len(candidate['files']) == 144
for item in candidate['files']:
    assert sha(task / item['path']) == item['sha256'], item['path']
validation = read(out / 'final-validation.json')
assert validation['passed'] and validation['stageGatesChecked'] == 6
for path, digest in validation['sourceHashes'].items():
    assert sha(Path(path)) == digest, path
assert validation['reportSha256'] == sha(out / 'final-report.md')
assert validation['matrixSha256'] == sha(out / 'coverage-matrix.json')
tree = yaml.safe_load((task / 'tree.yml').read_text())
assert tree['active'] == '09-completion' and tree['nodes']['09-completion']['status'] == 'in_progress'
assert all(n['status'] == 'done' for k, n in tree['nodes'].items() if k not in ['root', '09-completion'])

before = out / 'final-gate-before'
before.mkdir()
docs = ['README.md', 'tree.yml', 'nodes/root.md', 'nodes/09-completion.md', 'worklog.md',
        'evidence/completion/final-report.md', 'evidence/completion/final-validation.json']
for relative in docs:
    p = before / relative
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes((task / relative).read_bytes())
stamp = datetime.now(timezone.utc).isoformat()
title = 'docs: record SDK review and six staged SpineTree PoCs'
tree.update(phase='complete', active='root', updated_at=stamp)
tree['nodes']['root']['status'] = tree['nodes']['09-completion']['status'] = 'done'
(task / 'tree.yml').write_text(yaml.safe_dump(tree, sort_keys=False, allow_unicode=True))
for name in ['root', '09-completion']:
    p = task / f'nodes/{name}.md'
    s = p.read_text()
    s = re.sub(r'^status:.*$', 'status: done', s, flags=re.M)
    s = re.sub(r'^last:.*$', 'last: 审查修复和六阶段PoC验证已归并；精简证据随本次commit归档，自主可用性限制保留', s, flags=re.M)
    s = re.sub(r'^next:.*$', 'next: 本轮验证义务完成；后续改进范围见覆盖矩阵和未解决项', s, flags=re.M)
    s = s[:s.index('## Evidence')] + '''## Evidence

- ../evidence/completion/final-report.md
- ../evidence/completion/coverage-matrix.json
- ../evidence/completion/final-validation.json
- ../evidence/completion/gate-validation.json
- ../evidence/completion/final-slice.json

## Gate

- verification: 六阶段Gate及来源核验通过；机制和最终工作流成功，自主与通用可用性未建立
''' + f'- commit: 本节点随 `{title}` 提交；提交后blob核对记录在本地 evidence/completion/commit-receipt.json\n' + '''- include: 精简报告、脚本、结果、来源索引及任务路径symlink；确切文件见final-slice.json
- exclude: runtime/testbed/raw sessions/缓存/凭据/无关文件；原始数据本地保留
'''
    p.write_text(s)
p = task / 'README.md'
p.write_text(p.read_text().replace('按项目规范，最终 Gate 将任务目录归档到 `archive/`，并保留原 `tasks/` 路径的相对符号链接',
                                 '按项目规范，任务目录随最终证据提交归档到 `archive/`，并保留原 `tasks/` 路径的相对符号链接'))
p = out / 'final-report.md'
body = p.read_text().replace('exact selected paths and byte hashes will be recorded by the commit gate.',
                           'exact selected paths and byte hashes are in evidence/completion/final-slice.json (the manifest itself is verified through Git).')
body = body.replace('The final task gate still requires the compact evidence commit.',
                    f'The compact evidence slice is committed with `{title}`; the post-commit receipt stays local at evidence/completion/commit-receipt.json to avoid a self-referential commit hash. The task directory is archived and its old path remains a relative symlink.')
p.write_text(body)
validation['reportSha256'] = sha(p)
validation['finalGateReportUpdatedAt'] = stamp
validation['previousReportAndValidation'] = str(before / 'evidence/completion')
write(out / 'final-validation.json', validation)
with (task / 'worklog.md').open('a') as f:
    f.write(f'\n## {stamp} — 最终归并与精简提交\n\n01–09验证义务完成。四个生产提交已存在，最后一次生产HEAD为{source_commit}；本次只提交精简任务证据。'
            '六阶段Gate、来源hash和候选slice核对通过，不重跑模型或产品测试。'
            '两次提前final、漏Close/root复盘、事实误述及未支持merge/prune均在最终报告保留。'
            f'任务归档到archive/{task.name}，原tasks路径保留相对symlink；所有raw/runtime/失败资料保持本地可达。'
            f'提交标题：{title}。提交后blob核对结果记录本地commit-receipt.json，不递归追加commit。\n')

# Rename is local and reversible; no file is deleted, copied over, or retargeted.
archive.parent.mkdir(exist_ok=True)
task.rename(archive)
task.symlink_to(Path('..') / 'archive' / task.name, target_is_directory=True)
assert task.resolve() == archive and task.readlink() == Path('..') / 'archive' / task.name
for path, digest in validation['sourceHashes'].items():
    assert sha(Path(path)) == digest, path
for item in candidate['files']:
    if item['path'] not in docs:
        assert sha(task / item['path']) == item['sha256'], item['path']

selected = {i['path'] for i in candidate['files']}
selected.add('completion/archive-slice.py')
checks = {'pythonAst': 0, 'nodeSyntax': 0, 'json': 0, 'yaml': 0, 'whitespace': 0}
for relative in sorted(selected):
    p = task / relative
    text = p.read_text()
    assert all(line == line.rstrip() for line in text.splitlines()), relative
    checks['whitespace'] += 1
    if p.suffix == '.py':
        ast.parse(text)
        checks['pythonAst'] += 1
    elif p.suffix == '.mjs':
        subprocess.run(['node', '--check', str(p)], capture_output=True, check=True)
        checks['nodeSyntax'] += 1
    elif p.suffix == '.json':
        json.loads(text)
        checks['json'] += 1
    elif p.suffix == '.yml':
        yaml.safe_load(text)
        checks['yaml'] += 1
    if relative.startswith('nodes/'):
        assert re.findall(r'^## (.+)$', text, re.M) == ['Intent', 'Plan', 'State', 'Evidence', 'Gate']
assert all(n['status'] == 'done' for n in yaml.safe_load((task / 'tree.yml').read_text())['nodes'].values())
gate = {'passed': True, 'completedAt': stamp, 'sourceCommit': source_commit, 'evidenceCommitTitle': title,
        'stageGatesChecked': 6, 'sourceHashesRechecked': len(validation['sourceHashes']),
        'autonomousUsabilityPassed': False, 'generalUsabilityEstablished': False,
        'syntaxAndFormat': checks, 'modelsOrProductTestsRerun': False,
        'archive': str(archive), 'preservedTaskPath': str(task), 'symlinkTarget': str(task.readlink()),
        'rawInputsPreserved': True, 'rawInputsCommitted': False,
        'candidateSelectionSha256': sha(out / 'candidate-slice.json'),
        'finalReportSha256': sha(out / 'final-report.md'), 'finalValidationSha256': sha(out / 'final-validation.json'),
        'postCommitRequirement': 'Compare all listed blobs plus manifest and symlink; save commit-receipt locally.'}
write(out / 'gate-validation.json', gate)
selected.add('evidence/completion/gate-validation.json')
files = [{'path': str(archive.relative_to(repo) / relative), 'sha256': sha(task / relative),
          'bytes': (task / relative).stat().st_size} for relative in sorted(selected)]
files.append({'path': str(task.relative_to(repo)), 'sha256': hashlib.sha256(str(task.readlink()).encode()).hexdigest(),
              'bytes': len(str(task.readlink()).encode()), 'kind': 'symlink'})
slice_record = {'passed': True, 'sourceCommit': source_commit, 'commitTitle': title,
                'files': files, 'listedCount': len(files), 'listedBytes': sum(f['bytes'] for f in files),
                'manifestSelfExcluded': True, 'totalGitPathsIncludingManifest': len(files) + 1,
                'excluded': candidate['excluded'], 'localOnlyReceipt': 'evidence/completion/commit-receipt.json'}
write(out / 'final-slice.json', slice_record)
paths = [f['path'] for f in files] + [str(archive.relative_to(repo) / 'evidence/completion/final-slice.json')]
subprocess.run(['git', 'add', '--', *paths], cwd=repo, check=True)
assert set(git('diff', '--cached', '--name-only').splitlines()) == set(paths)
subprocess.run(['git', 'diff', '--cached', '--check'], cwd=repo, capture_output=True, check=True)
print(json.dumps({'passed': True, 'gitPaths': len(paths), 'listedBytes': slice_record['listedBytes'],
                  'checks': checks, 'archive': str(archive), 'next': 'Review staged summary; git commit; verify blobs.'}))
