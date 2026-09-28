"""Audit committed public events and persisted memory; omit thinking content."""
import collections
import hashlib
import json
from pathlib import Path
import sys

run, destination = map(lambda p: Path(p).resolve(), sys.argv[1:3])
ready = json.loads((run / 'ready.json').read_text())
first = json.loads((run / 'turn-1-state.json').read_text())
final = json.loads((run / 'final-state.json').read_text())
sessions = json.loads((run / 'sessions.json').read_text())
receipts, reports, all_calls, hashes = {}, [], [], {}
hash_file = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for session in sessions:
    path = Path(session['session'])
    pending, committed, calls, results, usages, errors, offers, operations = {}, {}, {}, {}, [], [], [], []
    owner = None
    first_ready_line = None
    mapping = {}
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
            results[key] = {'line': line, 'name': message['toolName'], 'isError': message.get('isError', False)}
        if row.get('customType') == 'spinetree.resources.v1':
            content = row['content']
            if not isinstance(content, str):
                content = ''.join(p.get('text', '') for p in content)
            offer = json.loads(content[content.index('{'):])
            offers.append({'line': line, 'branch': offer['branch'], 'scope': offer['scope'], 'skills': [{'name': s['name'], 'version': s['version'], 'source': s['source']} for s in offer['skills']]})
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
        if first_ready_line is None:
            first_ready_line = line
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
        for execution in receipt['record']['executions']:
            operations.append({'line': line, 'type': execution['operation']['type'], 'cursor': binding['scopeCursor']})
    assert pending.keys() == committed.keys()
    assert len(usages) == len(committed)
    assert calls.keys() == results.keys()
    for key, call in calls.items():
        assert call['name'] == results[key]['name']
        all_calls.append({'sessionId': session['sessionId'], **call, 'result': results[key]})
    for offer in offers:
        node = tuple(offer['scope']['nodeId'])
        if node in mapping:
            assert mapping[node] == offer['branch']
        else:
            # Before the first sampling, reexecution still advertises its
            # committed provisioning cursor; do not invent a canonical node.
            binding = final['branches'][owner['branch']]['reexecution']['binding']
            assert offer['line'] < first_ready_line
            assert binding['sessionId'] == session['sessionId']
            assert offer['scope']['nodeId'] == binding['scopeCursor']
            assert offer['branch'] == binding['branch'] == owner['branch']
            offer['provisioningCursor'] = True
    final_owner = final['registry'][owner['agentId']]
    assert all(final_owner[k] == v for k, v in owner.items())
    assert final_owner['status'] == 'ended'
    reports.append({'sessionId': session['sessionId'], 'session': str(path), 'bytes': path.stat().st_size, 'owner': owner, 'samplings': len(usages), 'canonicalReceipts': len(committed), 'toolPairs': len(calls), 'providerErrors': errors, 'toolErrors': [x for x in results.values() if x['isError']], 'operationCounts': dict(collections.Counter(x['type'] for x in operations)), 'offers': offers, 'usage': {k: sum(u.get(k, 0) for u in usages) for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}})
    hashes[str(path)] = hash_file(path)

revised = [b for b in final['branches'].values() if b.get('reexecution')]
assert len(revised) == 1
branch = revised[0]
old = first['branches'][branch['id']]
assert old['status'] == branch['status'] == 'capped'
assert old['memoryVersion'] == 1 and branch['memoryVersion'] == 2
assert all(old[k] == branch[k] for k in ['id', 'parent', 'goal', 'constraints', 'skills', 'tools'])
execution = branch['reexecution']
assert execution['state'] == 'completed'
for key in ['memory', 'memoryVersion', 'memorySource', 'scopeBinding']:
    assert execution['source'][key] == old[key]
assert branch['memorySource']['sessionId'] != old['memorySource']['sessionId']
assert execution['terminalSource'] == branch['memorySource']
for label, value in [('old', old), ('revised', branch)]:
    source = value['memorySource']
    receipt = receipts[source['transactionId']]
    projected = next(n for n in receipt['projection']['nodes'] if n['id'] == source['nodeId'])
    assert projected['memory'] == value['memory']
    assert receipt['record']['commit_id'] == source['commitId']
assert len(sessions) == len(final['registry']) == 2
assert all(a['status'] == 'ended' for a in final['registry'].values())
mail = list(final.get('mailbox', {}).get('receipts', {}).values())
assert len(mail) == 1 and mail[0]['status'] == 'observed'
assert mail[0]['recipient']['leaseId'] == execution['binding']['leaseId']
for path in [run / 'ready.json', run / 'sessions.json', run / 'final-state.json', *sorted(run.glob('turn-*-*.json')), *sorted(run.glob('session-*-answers.json'))]:
    hashes[str(path)] = hash_file(path)
report = {'passed': True, 'sameBranch': branch['id'], 'memoryVersions': [1, 2], 'previousMemoryAndSourceRetained': True, 'canonicalMemoryVerified': True, 'allAgentsEnded': True, 'sessions': reports, 'toolCalls': all_calls, 'mailbox': mail, 'branches': [{'id': b['id'], 'parent': b['parent'], 'goal': b['goal'], 'status': b['status'], 'memoryVersion': b['memoryVersion']} for b in final['branches'].values()], 'usage': {k: sum(s['usage'][k] for s in reports) for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}, 'hashes': hashes, 'limits': 'Checks public tool events, persisted receipts and memory provenance. Does not prove memory truth, independent parallelism, skill causality or provider payload identity.'}
destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'passed': True, 'sameBranch': branch['id'], 'sessions': len(reports), 'samplings': sum(s['samplings'] for s in reports), 'toolPairs': len(all_calls)}))
