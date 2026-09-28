import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const task = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sdk = join(task, 'runtime/sdk');
process.env.SPINE_PLUGIN_WORKSPACE = sdk;
const dir = resolve(process.argv[2]);
await mkdir(dir, { recursive: false });
const load = p => import(pathToFileURL(join(sdk, p)));
const core = 'node_modules/@earendil-works/pi-coding-agent/dist/core';
const [{ ModelRuntime }, { AuthStorage }, { AssistantMessageEventStream }, tree, { createSpineTreePiRuntimeFactory }] = await Promise.all([
  load(`${core}/model-runtime.js`), load(`${core}/auth-storage.js`),
  load('node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js'),
  load('packages/spinetree-plugin/dist/index.js'),
  import(pathToFileURL(join(task, 'runtime/poc/src/poc/spinetree-pi-runtime.mjs'))),
]);
const root = join(dir, 'tree'), agentDir = join(dir, 'agent'), sessionDir = join(dir, 'sessions');
await mkdir(agentDir); await mkdir(sessionDir);
const store = tree.GitSpineTreeStore.initialize(root, { schema: 'spinetree.snapshot/v2', branches: {
  root: { id: 'root', parent: null, goal: 'verify same-branch revision', status: 'live', constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null },
}});
const modelRuntime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
const observed = [], handles = [], samples = [], snapshots = [];
let target, phase = 'initial', parentStep = 0, childStep = 0;
const state = () => store.readSnapshot(store.head());
const remember = label => snapshots.push({ label, head: store.head(), state: state() });
const call = (name, args) => ({ name, args });
const v1 = 'parseMinorUnits accepts 12 and 12.34; leading-dot input is untested. Check first-check.json.';
const v2 = 'parseMinorUnits now accepts .50 => 50 and 12. => 1200; rejected exponent and plus. See revised-check.json. Previous evidence is retained as reexecution.source.';
modelRuntime.registerProvider('memory-fixture', {
  api: 'openai-completions', baseUrl: 'https://fixture.invalid', apiKey: 'fixture',
  models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  streamSimple(model, context, options) {
    void writeFile(join(dir, `context-${samples.length + 1}.json`), JSON.stringify(context.messages.filter(m => m.role === 'user'), null, 2) + '\n');
    // Fixture routing only: Pi projects the user anchor before the JSON and
    // may append a resource offer as another user message. Match our exact
    // structured mailbox payload within all public user text blocks.
    let envelope;
    for (const user of context.messages.filter(m => m.role === 'user')) {
      const blocks = typeof user.content === 'string' ? [user.content] : user.content.filter(p => p.type === 'text').map(p => p.text);
      for (const block of blocks) for (const line of block.split('\n')) {
        try { const value = JSON.parse(line); if (value.schema === 'spinetree.message/v1') envelope = value; } catch {}
      }
    }
    let op;
    if (envelope) {
      const ops = [
        () => call('spinetree_observe', { receiptId: envelope.receiptId, agentId: envelope.to, leaseId: envelope.leaseId }),
        () => call('spine_open', { goal: 'Recheck decimal parsing with leading or trailing dot' }),
        () => call('spine_close', { memory: v2 }),
      ];
      op = ops[childStep++]?.();
    } else if (phase === 'initial') {
      const ops = [() => call('spine_open', { goal: 'Check decimal parser contract' }), () => call('spine_close', { memory: v1 })];
      op = ops[parentStep++]?.();
    } else {
      const ops = [
        () => call('spinetree_read', { branch: target }),
        () => call('spinetree_rejuvenate', { parent: 'root', branch: target, request: 'recheck decimal edge inputs' }),
        () => {
          remember('ready-before-send');
          assert.equal(childStep, 0, 'readiness must not start sampling');
          return call('spinetree_send', { to: state().branches[target].reexecution.binding.agentId, message: 'Recheck .50 and 12.; preserve provenance and return updated memory.', requestId: 'decimal-revision-2' });
        },
        () => call('spinetree_dispatch', { waitForCompletion: true }),
        () => { remember('completed-before-parent-refresh'); return call('spinetree_read', { branch: target }); },
      ];
      op = ops[parentStep++]?.();
    }
    const sequence = samples.length + 1;
    samples.push({ sequence, owner: envelope ? 'reexecution' : 'parent', phase, tool: op?.name ?? null });
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: op ? [{ type: 'toolCall', id: `memory-fixture-${sequence}`, name: op.name, arguments: op.args }] : [{ type: 'text', text: 'Scripted fixture complete; this is not a real model result.' }],
      stopReason: op ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = new AssistantMessageEventStream();
    void (async () => { await options.onPayload?.({ model: model.id, messages: context.messages }, model); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); })().catch(error => {
      stream.push({ type: 'error', reason: 'error', error: { ...message, content: [], stopReason: 'error', errorMessage: error.message } }); stream.end();
    });
    return stream;
  },
});
const factory = createSpineTreePiRuntimeFactory({ root, cwd: dir, agentDir, sessionDir, modelRuntime, model: modelRuntime.getModel('memory-fixture', 'fixture'), thinkingLevel: 'off', settings: { compaction: { enabled: false } },
  onSession(handle) { handles.push(handle); handle.session.subscribe(e => { if (e.type === 'tool_execution_end') observed.push({ sessionId: handle.sessionManager.getSessionId(), toolName: e.toolName, isError: e.isError }); }); },
});
let parent;
try {
  parent = await factory.createSession({ id: randomUUID(), agent: { agentId: 'memory-parent', branch: 'root' }, name: 'memory-offline' });
  await parent.prompt({ text: 'initial' });
  target = Object.values(state().branches).find(b => b.id !== 'root').id;
  const first = structuredClone(state().branches[target]);
  assert.equal(first.memoryVersion, 1); assert.equal(first.status, 'capped');
  const parentOwner = structuredClone(state().registry['memory-parent']);
  remember('v1');
  phase = 'revision'; parentStep = 0;
  await parent.prompt({ text: 'revise existing branch' });
  const final = state(), revised = final.branches[target];
  assert.equal(revised.id, first.id); assert.equal(revised.parent, first.parent); assert.equal(revised.goal, first.goal);
  assert.equal(revised.memoryVersion, 2); assert.equal(revised.status, 'capped'); assert.equal(revised.reexecution.state, 'completed');
  assert.deepEqual(revised.reexecution.source.memory, first.memory);
  assert.deepEqual(revised.reexecution.source.memorySource, first.memorySource);
  assert.notEqual(revised.memorySource.sessionId, first.memorySource.sessionId);
  assert.equal(Object.keys(final.branches).length, 2);
  for (const key of ['agentId', 'sessionId', 'branch', 'bindingId', 'leaseId']) assert.equal(final.registry['memory-parent'][key], parentOwner[key]);
  const childBinding = final.registry[revised.reexecution.binding.agentId]; assert.equal(childBinding.status, 'ended');
  const mailbox = new tree.GitSpineTreeMailbox(store);
  const receipt = Object.values(final.mailbox.receipts)[0]; assert.equal(receipt.status, 'observed');
  const beforeReplay = store.head();
  const replay = await mailbox.enqueue({ to: receipt.to, from: receipt.from, message: receipt.message, requestId: receipt.requestId, recipient: receipt.recipient });
  assert.equal(replay.id, receipt.id); assert.equal(store.head(), beforeReplay);
  assert.equal(observed.filter(x => x.isError).length, 0);
  remember('v2-after-parent-refresh');
  await parent.dispose(); parent = null;
  assert.ok(Object.values(state().registry).every(x => x.status === 'ended'));
  await writeFile(join(dir, 'snapshots.json'), JSON.stringify(snapshots, null, 2) + '\n');
  const result = { passed: true, provider: 'scripted-no-network', sampleCount: samples.length, sameBranch: target, memoryVersions: [1, 2], oldSourcePreserved: true, parentRefreshPreservesV2: true, duplicateEnqueueWriteFree: true, branches: 2, agents: 2, allAgentsEnded: true, samples, tools: observed, sessions: handles.map(h => h.sessionManager.getSessionFile()), finalHead: store.head() };
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(join(dir, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, samples, observed, state: state() }, null, 2) + '\n');
  throw error;
} finally { await parent?.dispose(); }
