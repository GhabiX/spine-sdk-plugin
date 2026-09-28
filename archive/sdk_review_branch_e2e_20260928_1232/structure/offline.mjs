import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const task = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sdk = join(task, 'runtime-structure/sdk'); process.env.SPINE_PLUGIN_WORKSPACE = sdk;
const dir = resolve(process.argv[2]); await mkdir(dir, { recursive: false });
const load = p => import(pathToFileURL(join(sdk, p)));
const core = 'node_modules/@earendil-works/pi-coding-agent/dist/core';
const [{ ModelRuntime }, { AuthStorage }, { AssistantMessageEventStream }, tree, { createSpineTreePiRuntimeFactory }] = await Promise.all([
  load(`${core}/model-runtime.js`), load(`${core}/auth-storage.js`),
  load('node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js'),
  load('packages/spinetree-plugin/dist/index.js'),
  import(pathToFileURL(join(task, 'runtime-structure/poc/src/poc/spinetree-pi-runtime.mjs'))),
]);
const root = join(dir, 'tree'), agentDir = join(dir, 'agent'), sessionDir = join(dir, 'sessions');
await mkdir(agentDir); await mkdir(sessionDir);
const store = tree.GitSpineTreeStore.initialize(root, { schema: 'spinetree.snapshot/v2', branches: {
  root: { id: 'root', parent: null, goal: 'reorganize completed evidence and continue', status: 'live', constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null },
} });
const state = () => store.readSnapshot(store.head()), snapshots = [];
const capture = label => snapshots.push({ label, head: store.head(), state: state() });
const modelRuntime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
const samples = [], observed = [];
let step = 0, groupA, detail, groupB, later, original, archived, oldRevision;
const text = m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
const offerOf = context => context.messages.filter(m => m.role === 'user').flatMap(m => text(m).split('\n')).map(line => { try { return JSON.parse(line); } catch { return null; } }).findLast(x => x?.schema === 'spinetree.resources.v1');
const result = (ctx, error = false) => { const m = ctx.messages.findLast(m => m.role === 'toolResult'); assert.ok(m); assert.equal(m.isError === true, error, text(m)); return error ? text(m) : JSON.parse(text(m)); };
const call = (name, args) => ({ name, args });
const read = branch => call('spinetree_read', { branch });
const change = (branch, expectedRevision, operation) => call('spinetree_change', { changes: [{ branch, expectedRevision, ...operation }] });
const sameResult = (actual, expected) => { for (const k of ['id', 'goal', 'scopeBinding', 'memory', 'memoryVersion', 'memorySource', 'skills', 'tools']) assert.deepEqual(actual[k], expected[k], k); };
const plan = [
  () => call('spine_open', { goal: 'First group of checked obligations' }),
  (c, o) => { groupA = o.branch; return call('spine_open', { goal: 'Completed detail to retain across reorganization' }); },
  (c, o) => { detail = o.branch; return call('spine_close', { memory: 'Detail checked: two validation cases, result evidence stays attached to this Branch.' }); },
  () => call('spine_close', { memory: 'First group completed; checked detail remains addressable.' }),
  () => call('spine_open', { goal: 'Second group for organizing finished evidence' }),
  (c, o) => { groupB = o.branch; return call('spine_close', { memory: 'Second group completed; no active children.' }); },
  () => { original = structuredClone(state().branches[detail]); capture('before-move'); return read(detail); },
  c => change(detail, result(c).revision, { type: 'move', parent: groupB }),
  c => { assert.equal(result(c).applied, true); assert.equal(state().branches[detail].parent, groupB); sameResult(state().branches[detail], original); capture('moved'); return read(groupB); },
  c => change(groupB, result(c).revision, { type: 'move', parent: detail }),
  c => { assert.match(result(c, true), /cycle|descendant/i); assert.equal(state().branches[groupB].parent, 'root'); return read(detail); },
  c => { oldRevision = result(c).revision; return change(detail, oldRevision, { type: 'archive' }); },
  c => { assert.equal(result(c).applied, true); archived = structuredClone(state().branches[detail]); assert.equal(archived.status, 'archived'); sameResult(archived, original); capture('archived-before-continuation'); return read(detail); },
  c => { assert.equal(result(c).branch.status, 'archived'); assert.deepEqual(state().branches[detail], archived); return change(detail, oldRevision, { type: 'update', attributes: { goal: 'stale update must not apply' } }); },
  c => { assert.equal(result(c).applied, false); assert.deepEqual(state().branches[detail], archived); return call('spine_open', { goal: 'New work after archive' }); },
  (c, o) => { later = o.branch; assert.notEqual(later, detail); return read(later); },
  c => change(later, result(c).revision, { type: 'move', parent: groupA }),
  c => { assert.match(result(c, true), /active branch/i); return read(later); },
  c => change(later, result(c).revision, { type: 'archive' }),
  c => { assert.match(result(c, true), /live work/i); assert.equal(state().branches[later].parent, 'root'); assert.equal(state().branches[later].status, 'live'); return call('spine_close', { memory: 'Continued after archive. Cyclic movement, live movement, live archive and stale revision were rejected; original evidence was preserved.' }); },
  () => { assert.deepEqual(state().branches[detail], archived); capture('continued-after-archive'); return read(detail); },
];
modelRuntime.registerProvider('structure-fixture', { api: 'openai-completions', baseUrl: 'https://fixture.invalid', apiKey: 'fixture', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  streamSimple(model, context, options) {
    const offer = offerOf(context); assert.ok(offer); const operation = plan[step++]?.(context, offer);
    samples.push({ sequence: step, offer, operation: operation ?? null });
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: operation ? [{ type: 'toolCall', id: `structure-${step}`, name: operation.name, arguments: operation.args }] : [{ type: 'text', text: 'Scripted structure checks complete; this is not a model result.' }],
      stopReason: operation ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = new AssistantMessageEventStream();
    void (async () => { await options.onPayload?.({ model: model.id, messages: context.messages }, model); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); })().catch(e => { stream.push({ type: 'error', reason: 'error', error: { ...message, content: [], stopReason: 'error', errorMessage: e.message } }); stream.end(); });
    return stream;
  },
});
const factory = createSpineTreePiRuntimeFactory({ root, cwd: dir, agentDir, sessionDir, modelRuntime, model: modelRuntime.getModel('structure-fixture', 'fixture'), thinkingLevel: 'off', settings: { compaction: { enabled: false } },
  onSession(h) { h.session.subscribe(e => { if (e.type === 'tool_execution_end') observed.push({ name: e.toolName, isError: e.isError }); }); } });
let handle;
try {
  handle = await factory.createSession({ id: randomUUID(), agent: { agentId: 'structure-parent', branch: 'root' }, name: 'structure-offline' });
  const owner = structuredClone(state().registry['structure-parent']);
  await handle.prompt({ text: 'Run deterministic completed-branch reorganization checks.' });
  assert.equal(step, plan.length + 1); assert.equal(observed.filter(x => x.isError).length, 3);
  assert.equal(Object.keys(state().branches).length, 5);
  assert.deepEqual(state().branches[detail], archived);
  const current = state().registry['structure-parent'];
  for (const k of ['agentId', 'sessionId', 'branch', 'bindingId', 'leaseId']) assert.equal(current[k], owner[k]);
  const entries = handle.sessionManager.getEntries();
  const session = handle.sessionManager.getSessionFile();
  await handle.dispose(); handle = null;
  assert.ok(Object.values(state().registry).every(a => a.status === 'ended'));
  await writeFile(join(dir, 'snapshots.json'), JSON.stringify(snapshots, null, 2)+'\n');
  await writeFile(join(dir, 'samples.json'), JSON.stringify(samples, null, 2)+'\n');
  const output = { passed: true, provider: 'scripted-no-network', samplings: step, toolPairs: observed.length, expectedToolErrors: 3, expectedRevisionConflicts: 1,
    branches: { groupA, detail, groupB, later }, branchCount: 5, archiveRetainsMemoryAndSource: true, moveRetainsCanonicalSource: true,
    continuedAfterArchive: true, noBranchDeletion: true, allAgentsEnded: true, session, entryCount: entries.length, finalHead: store.head() };
  await writeFile(join(dir, 'result.json'), JSON.stringify(output, null, 2)+'\n'); console.log(JSON.stringify(output));
} catch (error) {
  await writeFile(join(dir, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, step, samples, observed, state: state() }, null, 2)+'\n'); throw error;
} finally { await handle?.dispose(); }
