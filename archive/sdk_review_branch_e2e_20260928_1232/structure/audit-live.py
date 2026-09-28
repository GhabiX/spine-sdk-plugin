"""Check persisted public events, canonical memory and project tree changes."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import subprocess

run, destination = [Path(p).resolve() for p in sys.argv[1:3]]
final = json.loads((run / 'final-state.json').read_text())
sessions = json.loads((run / 'sessions.json').read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
version = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
receipts, all_calls, reports, hashes = {}, [], [], {}
for session in sessions:
    path = Path(session['session'])
    pending, committed, calls, results, offers, use_events = {}, {}, {}, {}, {}, {}
    usages, errors, operations = [], [], []
    owner, mapping = None, {}
    for line, raw in enumerate(path.read_text().splitlines(), 1):
        row = json.loads(raw)
        message = row.get('message', {})
        if message.get('role') == 'assistant':
            usages.append(message.get('usage', {}))
            if message.get('stopReason') in ('error', 'aborted'):
                errors.append({'line': line, 'stopReason': message['stopReason'], 'error': message.get('errorMessage')})
            for block in message.get('content', []):
                if block.get('type') != 'toolCall':
                    continue
                assert block['id'] not in calls
                calls[block['id']] = {'line': line, 'name': block['name'], 'arguments': block['arguments']}
        if message.get('role') == 'toolResult':
            key = message['toolCallId']
            assert key not in results
            result = {'line': line, 'name': message['toolName'], 'isError': message.get('isError', False)}
            if message['toolName'].startswith('spinetree_'):
                result['details'] = message.get('details')
                result['content'] = [x for x in message.get('content', []) if x.get('type') == 'text']
            results[key] = result
        if row.get('customType') == 'spinetree.resources.v1':
            offer = row.get('details')
            if offer is None:
                content = row['content']
                if not isinstance(content, str):
                    content = ''.join(p.get('text', '') for p in content)
                offer = json.loads(content[content.index('{'):])
            for resource in offer['skills'] + offer['tools']:
                assert version(resource['descriptor']) == resource['version']
            if offer['snapshot'] in offers:
                assert offers[offer['snapshot']]['offer'] == offer
            else:
                offers[offer['snapshot']] = {'line': line, 'offer': offer}
        if row.get('customType') == 'spinetree.resource-use.v1':
            use = row['data']
            use_events.setdefault(use['toolCallId'], []).append({'line': line, **use})
        if row.get('customType') != 'spinetree.scope-import.v1':
            continue
        data = row['data']
        if data['state'] not in ('pending', 'ready'):
            continue
        receipt = data['receipt']
        key = receipt['transactionId']
        if data['state'] == 'pending':
            assert key not in pending
            pending[key] = receipt
            continue
        assert key not in committed and pending[key] == receipt
        committed[key] = receipt
        assert key not in receipts
        receipts[key] = receipt
        binding = receipt['binding']
        fixed = {k: binding[k] for k in ['agentId', 'sessionId', 'branch', 'bindingId', 'leaseId', 'epoch']}
        if owner is None:
            owner = fixed
            mapping[(1,)] = fixed['branch']
        assert fixed == owner and fixed['sessionId'] == session['sessionId']
        for selection in data['selections']:
            node = tuple(selection['nodeId'])
            assert node not in mapping or mapping[node] == selection['branch']
            mapping[node] = selection['branch']
        assert binding['scopeCursor'] == receipt['projection']['cursor']
        assert tuple(binding['scopeCursor']) in mapping
        operations.extend({'line': line, 'type': x['operation']['type']} for x in receipt['record']['executions'])
    assert pending.keys() == committed.keys()
    assert len(usages) == len(committed)
    assert calls.keys() == results.keys()
    for key, call in calls.items():
        assert call['name'] == results[key]['name']
        all_calls.append({'id': key, 'sessionId': session['sessionId'], **call, 'result': results[key]})
    for entry in offers.values():
        offer = entry['offer']
        assert mapping[tuple(offer['scope']['nodeId'])] == offer['branch']
    assert not use_events, 'resource execution was not part of this structure task'
    actual = final['registry'][owner['agentId']]
    assert all(actual[k] == v for k, v in owner.items()) and actual['status'] == 'ended'
    reports.append({'sessionId': session['sessionId'], 'path': str(path), 'bytes': path.stat().st_size, 'owner': owner, 'samplings': len(usages), 'canonicalReceipts': len(committed), 'toolPairs': len(calls), 'providerErrors': errors, 'toolErrors': [r for r in results.values() if r['isError']], 'operationCounts': dict(collections.Counter(x['type'] for x in operations)), 'offerCount': len(offers), 'resourceEvents': [e for items in use_events.values() for e in items], 'usage': {k: sum(u.get(k, 0) for u in usages) for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}})
    hashes[str(path)] = sha(path)
for branch in final['branches'].values():
    if branch.get('memorySource') is None:
        continue
    source = branch['memorySource']
    receipt = receipts[source['transactionId']]
    node = next(n for n in receipt['projection']['nodes'] if n['id'] == source['nodeId'])
    assert node['memory'] == branch['memory']
    assert receipt['record']['commit_id'] == source['commitId']
for path in [run / 'ready.json', run / 'sessions.json', run / 'final-state.json', *sorted(run.glob('turn-*-*.json')), *sorted(run.glob('session-*-answers.json'))]:
    hashes[str(path)] = sha(path)
git = ['git', '--git-dir=' + str(run / '.spinetree/.git')]
commits = subprocess.check_output(git + ['rev-list', '--reverse', 'HEAD'], text=True).splitlines()
previous = None
changes = []
created = []
all_ids = set()
for commit in commits:
    snapshot = json.loads(subprocess.check_output(git + ['show', commit + ':state.json']))
    branches = snapshot['branches']
    assert all_ids <= branches.keys(), 'persistent branch disappeared'
    created.extend({'commit': commit, 'branch': key, 'parent': branches[key]['parent'], 'goal': branches[key]['goal']} for key in branches if key not in all_ids)
    all_ids.update(branches)
    if previous is not None:
        for key, before in previous['branches'].items():
            after = branches[key]
            fields = [field for field in set(before) | set(after) if before.get(field) != after.get(field)]
            if before['parent'] != after['parent'] or before['status'] != after['status'] and after['status'] == 'archived':
                assert before['status'] == 'capped'
                assert set(fields) <= {'parent', 'status', 'revision'}
                for field in ['id', 'goal', 'memory', 'memoryVersion', 'memorySource', 'scopeBinding', 'skills', 'tools', 'constraints']:
                    assert before.get(field) == after.get(field), field
                changes.append({'commit': commit, 'branch': key, 'fields': fields, 'beforeParent': before['parent'], 'afterParent': after['parent'], 'beforeStatus': before['status'], 'afterStatus': after['status'], 'memoryVersion': after['memoryVersion'], 'memorySource': after['memorySource']})
    previous = snapshot
assert previous == final
for change in changes:
    assert any(call['name'] == 'spinetree_change' and any(item['branch'] == change['branch'] and item['type'] == ('archive' if 'status' in change['fields'] else 'move') for item in call['arguments']['changes']) for call in all_calls)
report = {'passed': True, 'canonicalMemoryVerified': True, 'allAgentsEnded': True, 'gitSnapshots': len(commits), 'structureChanges': changes, 'createdBranches': created, 'commitOrder': commits, 'persistentIdsRetained': True, 'sessions': reports, 'toolCalls': all_calls, 'branches': [{'id': b['id'], 'parent': b['parent'], 'goal': b['goal'], 'status': b['status'], 'memoryVersion': b['memoryVersion']} for b in final['branches'].values()], 'usage': {k: sum(s['usage'][k] for s in reports) for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}, 'hashes': hashes, 'limits': 'Move changes project parent, not canonical source. Archive keeps identity and memory; it neither merges UUIDs nor removes canonical context. Functional checks cover only their tested inputs.'}
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': True, 'samplings': sum(s['samplings'] for s in reports), 'toolPairs': len(all_calls), 'structureChanges': len(changes)}))
