"""Check public collaboration events, canonical receipts and durable identities.

Inherited parent transcript prefixes are excluded from child event/usage counts.
Assistant thinking blocks are never rendered or copied into this report.
"""
import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys

run, destination = [Path(p).resolve() for p in sys.argv[1:3]]
first = json.loads((run / 'turn-1-state.json').read_text())
final = json.loads((run / 'final-state.json').read_text())
ready = json.loads((run / 'ready.json').read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
git = lambda *args: subprocess.check_output(['git', '-C', str(run / '.spinetree'), *args], text=True)
heads = git('rev-list', '--reverse', 'HEAD').splitlines()
states = {h: json.loads(git('show', h + ':state.json')) for h in heads}
assert states[heads[-1]] == final
receipts, session_reports, calls_all, terminals, hashes = {}, [], [], [], {}
session_rows = {}
for path in sorted((run / '.pi-sessions').rglob('*.jsonl')):
    rows = [json.loads(raw) for raw in path.read_text().splitlines()]
    sid = rows[0]['id']
    starts = [i for i, row in enumerate(rows) if row.get('customType') == 'spinetree.scope-import.v1'
              and row.get('data', {}).get('state') == 'start' and row['data'].get('sessionId') == sid]
    assert len(starts) == 1, (path, starts)
    start = starts[0]
    session_rows[sid] = rows[start:]
    pending, committed, calls, results, owner = {}, {}, {}, {}, None
    usages, faults, errors, offers, operations, sample_times = [], [], [], [], [], []
    mapping = {}
    for line, row in enumerate(rows[start:], start + 1):
        message = row.get('message', {})
        if message.get('role') == 'assistant':
            usages.append(message.get('usage', {}))
            sample_times.append(row['timestamp'])
            if message.get('stopReason') in ('error', 'aborted'):
                errors.append({'line': line, 'stopReason': message['stopReason'], 'error': message.get('errorMessage')})
            for block in message.get('content', []):
                if block.get('type') != 'toolCall':
                    continue
                assert block['id'] not in calls
                calls[block['id']] = {'id': block['id'], 'line': line, 'at': row['timestamp'],
                                      'name': block['name'], 'arguments': block['arguments']}
        if message.get('role') == 'toolResult':
            key = message['toolCallId']
            assert key not in results
            results[key] = {'line': line, 'at': row['timestamp'], 'name': message['toolName'],
                            'isError': message.get('isError', False)}
        kind = row.get('customType')
        if kind == 'spine.fault.v1':
            faults.append({'line': line, 'data': row['data']})
        if kind == 'spine.spawn-terminal.v1':
            terminals.append({'sessionId': sid, 'line': line, 'at': row['timestamp'], **row['data']})
        if kind == 'spinetree.resources.v1':
            content = row['content']
            if not isinstance(content, str):
                content = ''.join(p.get('text', '') for p in content)
            offer = json.loads(content[content.index('{'):])
            offers.append({'line': line, 'head': offer['head'], 'branch': offer['branch'], 'scope': offer['scope'],
                           'skills': [{'name': s['name'], 'version': s['version'], 'source': s['source']} for s in offer['skills']]})
        if kind != 'spinetree.scope-import.v1':
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
        assert fixed == owner and fixed['sessionId'] == sid
        for selection in data['selections']:
            node = tuple(selection['nodeId'])
            assert node not in mapping or mapping[node] == selection['branch']
            mapping[node] = selection['branch']
        assert binding['scopeCursor'] == receipt['projection']['cursor']
        for execution in receipt['record']['executions']:
            operations.append({'line': line, 'type': execution['operation']['type'], 'cursor': binding['scopeCursor']})
    assert pending.keys() == committed.keys()
    assert len(usages) == len(committed), (sid, len(usages), len(committed))
    assert calls.keys() == results.keys(), (sid, calls.keys() - results.keys(), results.keys() - calls.keys())
    assert owner is not None
    for key, call in calls.items():
        assert call['name'] == results[key]['name']
        calls_all.append({'sessionId': sid, **call, 'result': results[key]})
    for offer in offers:
        state = states[offer['head']]
        binding = state['registry'][owner['agentId']]
        assert binding['sessionId'] == sid and binding['branch'] == owner['branch']
        assert binding['bindingId'] == owner['bindingId'] and binding['leaseId'] == owner['leaseId']
        assert binding['scopeCursor'] == offer['scope']['nodeId']
        assert binding['epoch'] == offer['scope']['epoch']
        branch = state['branches'][offer['branch']]
        scope = branch.get('scopeBinding')
        if offer['scope']['nodeId'] == [1] and offer['branch'] == owner['branch']:
            # After a reexecution closes its result Task, the session returns
            # to RootEpoch while H still denotes that same persistent Branch.
            # Its scopeBinding continues to identify the closed result Task.
            offer['assignmentRootFloor'] = True
        elif scope and scope['sessionId'] == sid:
            assert scope['nodeId'] == offer['scope']['nodeId']
        else:
            assert offer['branch'] == owner['branch']
            offer['assignmentOrProvisioningFloor'] = True
    final_owner = final['registry'][owner['agentId']]
    assert all(final_owner[k] == value for k, value in owner.items())
    assert final_owner['status'] == 'ended'
    session_reports.append({'sessionId': sid, 'path': str(path), 'bytes': path.stat().st_size,
                            'ownStartLine': start + 1, 'owner': owner, 'samplings': len(usages),
                            'canonicalReceipts': len(committed), 'toolPairs': len(calls),
                            'sampleInterval': [sample_times[0], sample_times[-1]],
                            'providerErrors': errors, 'faults': faults,
                            'toolErrors': [r for r in results.values() if r['isError']],
                            'operationCounts': dict(collections.Counter(o['type'] for o in operations)),
                            'offers': offers, 'usage': {k: sum(u.get(k, 0) for u in usages)
                            for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']}})
    hashes[str(path)] = sha(path)

spawned = [b for b in first['branches'].values() if b.get('spawnReservation')]
assert len(spawned) == len(terminals) == 2
spawn_calls = [c for c in calls_all if c['name'] == 'spine_spawn']
returns = [c for c in calls_all if c['name'] == 'spine_child_return']
assert len(spawn_calls) == 1 and len(returns) == 2
for branch in spawned:
    reservation = branch['spawnReservation']
    assert reservation['state'] == 'terminal' and reservation['outcome'] == 'completed'
    assert branch['parent'] == reservation['parentBranch'] == reservation['handoff']['to']['parent']
    assert branch['scopeBinding'] == reservation['handoff']['to']['scopeBinding']
    assert branch['memorySource']['transactionId'] == reservation['handoff']['transactionId']
    terminal = next(t for t in terminals if t['result']['ordinal'] == reservation['ordinal'])
    call = next(c for c in returns if c['sessionId'] == reservation['sessionId'])
    assert terminal['result']['memory_body'] == call['arguments']['memory']
    assert terminal['batchId'] == reservation['batchId'] == spawn_calls[0]['id']
    assert terminal['result']['execution_ref'] == reservation['launchId'] + ':' + reservation['sessionId']
    assert reservation['handoff']['from']['binding'] == first['registry'][reservation['agentId']]

child_reports = [s for s in session_reports if s['sessionId'] in {b['spawnReservation']['sessionId'] for b in spawned}]
assert max(s['sampleInterval'][0] for s in child_reports) < min(s['sampleInterval'][1] for s in child_reports)
revised = [b for b in final['branches'].values() if b.get('reexecution')]
assert len(revised) == 1
branch = revised[0]
old = first['branches'][branch['id']]
assert old in spawned
assert old['memoryVersion'] == 1 and branch['memoryVersion'] == 2
assert old['status'] == branch['status'] == 'capped'
assert all(old[k] == branch[k] for k in ['id', 'parent', 'goal', 'constraints', 'skills', 'tools', 'spawnReservation'])
execution = branch['reexecution']
assert execution['state'] == 'completed'
for key in ['memory', 'memoryVersion', 'memorySource', 'scopeBinding']:
    assert execution['source'][key] == old[key]
assert execution['terminalSource'] == branch['memorySource']
assert branch['memorySource']['sessionId'] != old['memorySource']['sessionId']
for state in [first, final]:
    for b in state['branches'].values():
        if b['memorySource'] is None:
            continue
        source = b['memorySource']
        receipt = receipts[source['transactionId']]
        projected = next(n for n in receipt['projection']['nodes'] if n['id'] == source['nodeId'])
        assert projected['memory'] == b['memory']
        assert receipt['record']['commit_id'] == source['commitId']
mail = list(final.get('mailbox', {}).get('receipts', {}).values())
assert len(mail) == 1 and mail[0]['status'] == 'observed'
assert mail[0]['recipient']['leaseId'] == execution['binding']['leaseId']
assert len(session_reports) == len(final['registry']) == 4
assert all(a['status'] == 'ended' for a in final['registry'].values())
assert final['registry'][ready['agentId']]['scopeCursor'] == [1]
assert all(b['status'] == 'capped' for b in final['branches'].values() if b['id'] != 'root')
counts = dict(collections.Counter(c['name'] for c in calls_all))
assert all(counts.get(name) == 1 for name in ['spinetree_rejuvenate', 'spinetree_send', 'spinetree_dispatch', 'spinetree_observe'])
assert not any(counts.get(name, 0) for name in ['spinetree_change', 'spinetree_execute'])
for p in [run / 'ready.json', run / 'sessions.json', run / 'final-state.json', run / 'launch.log',
          *sorted(run.glob('turn-*-*.json')), *sorted(run.glob('session-*-answers.json'))]:
    hashes[str(p)] = sha(p)
report = {'passed': True, 'sameBranch': branch['id'], 'memoryVersions': [1, 2],
          'previousMemoryAndSourceRetained': True, 'canonicalMemoryVerified': True,
          'allAgentsEnded': True, 'sessions': session_reports, 'toolCounts': counts, 'toolCalls': calls_all,
          'typedTerminals': terminals, 'spawnedBranches': [b['id'] for b in spawned],
          'childSamplingIntervalsOverlap': True, 'mailbox': mail, 'gitHeads': heads,
          'branches': [{'id': b['id'], 'parent': b['parent'], 'goal': b['goal'], 'status': b['status'],
                        'memoryVersion': b['memoryVersion']} for b in final['branches'].values()],
          'usage': {k: sum(s['usage'][k] for s in session_reports)
                    for k in ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']},
          'hashes': hashes, 'limits': ['Public events and durable state establish execution and provenance, not skill causality.',
                                     'Overlapping child sample intervals do not measure parallel speedup.',
                                     'Only adapter-owned reexecution messaging is exercised.']}
destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'passed': True, 'sessions': len(session_reports), 'sameBranch': branch['id'],
                  'samplings': sum(s['samplings'] for s in session_reports), 'tools': len(calls_all), 'gitHeads': len(heads)}))
