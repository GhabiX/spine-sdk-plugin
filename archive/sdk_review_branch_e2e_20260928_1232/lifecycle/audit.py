import collections
import hashlib
import json
from pathlib import Path
import sys

run = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
ready = json.loads((run / 'ready.json').read_text())
session = Path(ready['session'])
rows = [json.loads(line) for line in session.read_text().splitlines()]
state = json.loads((run / 'final-state.json').read_text())
pending, committed, calls, results, operations, usages, errors = {}, {}, {}, {}, [], [], []
owner = None
mapping = {(1,): 'root'}
offers = []
for line, row in enumerate(rows, 1):
    message = row.get('message', {})
    if message.get('role') == 'assistant':
        if message['stopReason'] in ('error', 'aborted'):
            errors.append({'line':line,'stopReason':message['stopReason'],'message':message.get('errorMessage')})
            assert message['stopReason'] == 'error' and message.get('errorMessage') == 'Error Code upstream_stream_read_error: Upstream response stream was interrupted'
            assert not any(part.get('type') == 'toolCall' for part in message['content'])
        usages.append(message.get('usage', {}))
        for part in message['content']:
            if part.get('type') == 'toolCall':
                assert part['id'] not in calls
                calls[part['id']] = (line, part['name'])
    elif message.get('role') == 'toolResult':
        identity = message['toolCallId']
        assert identity not in results
        results[identity] = {'line': line, 'tool': message['toolName'], 'isError': message.get('isError', False)}
    if row.get('customType') == 'spinetree.resources.v1':
        content = row['content']
        if not isinstance(content, str):
            content = ''.join(item.get('text', '') for item in content)
        offer = json.loads(content[content.index('{'):])
        assert mapping[tuple(offer['scope']['nodeId'])] == offer['branch']
        offers.append({'line':line,'branch':offer['branch'],'node':offer['scope']['nodeId'],'skills':[{'name':item['name'],'source':item['source'],'version':item['version']} for item in offer['skills']]})
    if row.get('customType') != 'spinetree.scope-import.v1':
        continue
    data = row['data']
    if data['state'] not in ('pending', 'ready'):
        continue
    receipt = data['receipt']
    identity = receipt['transactionId']
    if data['state'] == 'pending':
        assert identity not in pending
        pending[identity] = receipt
        continue
    assert identity not in committed
    assert pending[identity] == receipt, identity
    committed[identity] = receipt
    binding = receipt['binding']
    fixed = {key: binding[key] for key in ('agentId', 'sessionId', 'bindingId', 'leaseId', 'branch', 'epoch')}
    if owner is None:
        owner = fixed
    assert owner == fixed
    assert owner['agentId'] == ready['agentId'] and owner['sessionId'] == ready['sessionId'] and owner['branch'] == 'root'
    for selected in data['selections']:
        node = tuple(selected['nodeId'])
        assert node not in mapping or mapping[node] == selected['branch']
        mapping[node] = selected['branch']
    assert binding['scopeCursor'] == receipt['projection']['cursor']
    assert tuple(binding['scopeCursor']) in mapping
    for execution in receipt['record']['executions']:
        operation = execution['operation']
        operations.append({'line':line, 'transaction':identity, 'type':operation['type'], 'summary':operation.get('summary'), 'cursorAfter':binding['scopeCursor']})
assert set(pending) == set(committed)
assert len(committed) == len(usages)
assert set(calls) == set(results)
assert all(calls[key][1] == results[key]['tool'] for key in calls)
assert not any(result['isError'] for result in results.values())
assert len(state['registry']) == 1
agent = state['registry'][ready['agentId']]
assert agent['status'] == 'ended'
for key, value in owner.items():
    assert agent[key] == value, key
assert agent['scopeCursor'] == [1]
assert len(mapping) == len(state['branches'])
branches = []
for node, branch_id in mapping.items():
    branch = state['branches'][branch_id]
    if branch_id != 'root':
        assert branch['parent'] == mapping[node[:-1]]
        assert branch['scopeBinding']['nodeId'] == list(node)
        assert branch['scopeBinding']['sessionId'] == ready['sessionId']
        assert branch['status'] == 'capped' and branch['memoryVersion'] == 1
        source = branch['memorySource']
        receipt = committed[source['transactionId']]
        projected = next(item for item in receipt['projection']['nodes'] if item['id'] == list(node))
        assert branch['memory'] == projected['memory']
        assert source['commitId'] == receipt['record']['commit_id']
    branches.append({'id':branch_id,'node':list(node),'parent':branch['parent'],'goal':branch['goal'],'status':branch['status'],'memoryVersion':branch['memoryVersion']})
counts = collections.Counter(item['type'] for item in operations)
assert all(counts[name] for name in ['open','next','close'])
hashes = {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in [session,run/'ready.json',run/'final-state.json',*sorted(run.glob('turn-*-input.json')),*sorted(run.glob('turn-*-answer.json'))]}
report = {'passed':True,'session':str(session),'sessionBytes':session.stat().st_size,'samplings':len(usages),'canonicalReceipts':len(committed),'toolPairs':len(calls),'errors':errors,'operationCounts':dict(counts),'operations':operations,'branches':branches,'offerCount':len(offers),'offers':offers,'owner':owner,'memoryAndMappingVerified':True,'usage':{key:sum(item.get(key,0) for item in usages) for key in ['input','output','cacheRead','cacheWrite','totalTokens']},'hashes':hashes,'limits':'Canonical receipts and final persisted tree verified. Does not capture provider request bodies, prove skill causality, or test reexecution/resources/parallel Agents.'}
destination.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({key:report[key] for key in ['passed','samplings','canonicalReceipts','toolPairs','operationCounts','offerCount']}))
