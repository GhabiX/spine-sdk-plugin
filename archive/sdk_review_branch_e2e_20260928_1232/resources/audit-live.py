"""Check persisted public events, resource versions and canonical memory sources."""
import collections
import hashlib
import json
from pathlib import Path
import sys

run, destination = [Path(p).resolve() for p in sys.argv[1:3]]
final = json.loads((run / 'final-state.json').read_text())
sessions = json.loads((run / 'sessions.json').read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
version = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
receipts, all_calls, reports, hashes, publications, invocations = {}, [], [], {}, [], []
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
    for key, events in use_events.items():
        call, result = calls[key], results[key]
        assert call['name'] == 'spinetree_execute'
        args = call['arguments']
        end = events[-1]
        if end['phase'] == 'rejected':
            assert len(events) == 1 and result['isError']
            continue
        assert len(events) == 2 and events[0]['phase'] == 'started'
        assert end['phase'] in ('succeeded', 'failed')
        offer_entry = offers[args['snapshot']]
        assert offer_entry['line'] < call['line']
        offer = offer_entry['offer']
        resource = next(t for t in offer['tools'] if t['name'] == args['name'] and t['version'] == args['version'])
        for event in events:
            assert event['snapshot'] == args['snapshot']
            assert event['name'] == args['name'] and event['version'] == args['version']
            assert event['source'] == resource['source']
            assert event['branch'] == offer['branch'] and event['scope'] == offer['scope']
            for skill in event['declaredSkills']:
                assert any(all(s[k] == skill[k] for k in ['name', 'version', 'source']) for s in offer['skills'])
        details = result.get('details')
        if details:
            value = details.get('result')
        else:
            value = json.loads(result['content'][0]['text'])
        if end['phase'] != 'succeeded':
            continue
        if args['name'] == 'publish-resource':
            assert value['applied'] is True and value['evidenceStatus'] == 'declared'
            assert version(value['descriptor']) == value['version']
            publications.append({'line': call['line'], 'resultLine': result['line'], 'branch': value['branch'], 'name': value['name'], 'kind': value['kind'], 'version': value['version'], 'revision': value['revision'], 'descriptor': value['descriptor']})
        else:
            implementation = resource['descriptor']['implementation']
            if implementation['kind'] != 'node-script':
                continue
            file = Path(implementation['path'])
            assert file.is_relative_to(run)
            assert sha(file) == implementation['sha256']
            hashes[str(file)] = sha(file)
            assert value['code'] == 0 and not value.get('killed')
            invocations.append({'line': call['line'], 'resultLine': result['line'], 'branch': offer['branch'], 'source': resource['source'], 'name': args['name'], 'version': args['version'], 'input': args.get('input'), 'output': json.loads(value['stdout']), 'declaredSkills': end['declaredSkills'], 'path': str(file), 'sha256': implementation['sha256']})
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
for invocation in invocations:
    assert any(p['line'] < invocation['line'] and p['version'] == invocation['version'] and p['name'] == invocation['name'] for p in publications)
for path in [run / 'ready.json', run / 'sessions.json', run / 'final-state.json', *sorted(run.glob('turn-*-*.json')), *sorted(run.glob('session-*-answers.json'))]:
    hashes[str(path)] = sha(path)
report = {'passed': True, 'canonicalMemoryVerified': True, 'allAgentsEnded': True, 'sessions': reports, 'toolCalls': all_calls, 'publications': publications, 'invocations': invocations, 'branches': [{'id': b['id'], 'parent': b['parent'], 'goal': b['goal'], 'status': b['status'], 'memoryVersion': b['memoryVersion']} for b in final['branches'].values()], 'usage': {k: sum(s['usage'][k] for s in reports) for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}, 'hashes': hashes, 'limits': 'Skill association is not adherence; publication evidence is a declaration. Independent candidate checks and public commands establish only their tested inputs.'}
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': True, 'samplings': sum(s['samplings'] for s in reports), 'toolPairs': len(all_calls), 'publications': len(publications), 'invocations': len(invocations)}))
