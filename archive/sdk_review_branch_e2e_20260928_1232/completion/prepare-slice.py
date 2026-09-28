"""Select compact evidence explicitly; preserve all excluded files locally."""
import ast
import hashlib
import json
from pathlib import Path
import re

task = Path(__file__).resolve().parents[1]
out = task / 'evidence/completion'
read = lambda p: json.loads(p.read_text())
selected = {'README.md', 'tree.yml', 'worklog.md'}
selected.update(str(p.relative_to(task)) for p in (task / 'nodes').glob('*.md'))
selected.update(read(out / 'final-validation.json')['include'])
stages = ['lifecycle', 'memory', 'resources', 'structure', 'collaboration', 'composition']
for stage in stages:
    selected.update(str(p.relative_to(task)) for p in (task / stage).iterdir() if p.suffix in ['.py', '.mjs'])
    for name in ['live-validation.json', 'offline-report.md', 'offline-validation.json', 'interaction-review.json',
                 'usability-review.json', 'candidate-initial.json', 'candidate-revised.json',
                 'candidate-local.json', 'candidate-before.json', 'candidate-after.json', 'candidate-cli-errors.json']:
        p = task / 'evidence' / stage / name
        if p.is_file():
            selected.add(str(p.relative_to(task)))
selected.update(['evidence/lifecycle/reload-diagnosis.json', 'evidence/lifecycle/candidate-check.json',
                 'evidence/lifecycle/array-boundary-check.json', 'evidence/composition/offline-result.json',
                 'evidence/composition/runtime-review.md', 'evidence/composition/trajectory-review.md',
                 'evidence/composition/interaction-session-closed.json', 'evidence/collaboration/ownership-review.md',
                 'evidence/collaboration/runtime-close-review.md', 'evidence/collaboration/runtime-close-validation.json',
                 'evidence/integration/review.md', 'evidence/commit/whitespace.json'])
for folder in ['pi-fix', 'tree-fix', 'memory/read-contract', 'structure/archive-fix', 'collaboration/git-lock']:
    selected.update('evidence/' + folder + '/' + f for f in ['report.md', 'validation.json'])
selected.update(str(p.relative_to(task)) for p in (task / 'completion').glob('*.py'))
items = []
for relative in sorted(selected):
    p = task / relative
    assert p.is_file() and not p.is_symlink(), relative
    assert not any(part.startswith('runtime') or part in ['temp', 'node_modules', '__pycache__'] for part in p.relative_to(task).parts[:-1]), relative
    assert p.suffix in ['.py', '.mjs', '.md', '.json', '.yml'], relative
    data = p.read_bytes()
    body = data.decode('utf-8')
    assert not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{32,}', body), relative
    if p.suffix == '.py':
        ast.parse(body)
    items.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
record = {'passed': True, 'phase': 'candidate-selection-before-final-gate', 'files': items,
          'fileCount': len(items), 'totalBytes': sum(v['bytes'] for v in items),
          'excluded': ['runtime copies', 'testbeds and raw sessions', 'intermediate logs and backups', 'credentials', 'unrelated files'],
          'publication': False, 'scriptRequiresLocalInputs': True,
          'remaining': 'Update final nodes, record exact final file hashes, archive with the original path symlink, then commit and verify blobs.'}
(out / 'candidate-slice.json').write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({k: record[k] for k in ['passed', 'fileCount', 'totalBytes']}))
