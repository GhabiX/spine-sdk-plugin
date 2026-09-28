import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createRootCapabilityBasis } from "file:///data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-structure/poc/src/poc/spinetree-root-capabilities.mjs";
import { resourceVersion } from "file:///data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-structure/poc/src/poc/spinetree-resources.mjs";

const project = "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-structure/poc";
const workspace = process.env.SPINE_PLUGIN_WORKSPACE;
if (!workspace) throw new Error("Use an isolated SPINE_PLUGIN_WORKSPACE");
const { GitSpineTreeStore } = await import(pathToFileURL(join(workspace, "packages/spinetree-plugin/dist/index.js")).href);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("actual Pi mixed process → reexecution → process inherits and refines five root capabilities", async t => {
  const temporary = "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/temp/null/20260928_1610/collaboration-offline"; await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(join(temporary, "run-"));
  t.diagnostic(`Retained mixed proof: ${directory}`);
  const root = join(directory, "tree"), agentDir = join(directory, "agent"), sessionDir = join(directory, "sessions");
  const blackboard = join(directory, "shared-checks");
  await mkdir(agentDir); await mkdir(sessionDir); await mkdir(blackboard);
  const branch = (id, parent) => ({ id, parent, status: "live", goal: id, memory: null, memoryVersion: 0,
    memorySource: null, constraints: [], skills: [], tools: [] });
  const basis = createRootCapabilityBasis();
  const store = GitSpineTreeStore.initialize(root, { schema: "spinetree.snapshot/v2", branches: {
    root: { ...branch("root", null), ...basis }, task: branch("task", "root"),
  } });
  const scripts = {}, scriptHashes = {};
  for (const multiplier of [2, 3]) {
    const source = `const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({value:x.value*${multiplier}}));\n`;
    scripts[multiplier] = join(directory, `measure-${multiplier}.mjs`); scriptHashes[multiplier] = digest(source);
    await writeFile(scripts[multiplier], source);
    assert.equal(JSON.parse(execFileSync(process.execPath,
      ["--input-type=module", "--eval", source, "--", '{"value":7}'], { encoding: "utf8" })).value, 7 * multiplier);
  }
  const overrideDescriptor = { schema: "spinetree.skill/v1", name: "discover-and-invoke",
    contract: { input: "A local offered operation and input", output: "Recorded exact version, source and observed value", preconditions: [] },
    evidence: { status: "declared", checks: [{ check: "Inherited and local measure with input 7", result: "14 then 21" }] },
    instruction: "For this branch record the exact offered version and source with each measured value. This locally refines discovery without changing ancestor instructions." };
  const provider = join(project, "src/poc/test/fixtures/root-capabilities-provider.mjs");
  const preload = join(directory, "no-network.mjs"), networkAttempts = join(directory, "network-attempts.jsonl");
  await writeFile(preload, `import { appendFileSync } from 'node:fs';\n` +
    `globalThis.fetch = async () => { appendFileSync(${JSON.stringify(networkAttempts)}, JSON.stringify({pid:process.pid})+'\\n'); throw new Error('Mixed proof forbids network'); };\n` +
    `const separator = process.argv.indexOf('--');\n` +
    `process.argv.splice(separator < 0 ? process.argv.length - 1 : separator, 0, '--extension', ${JSON.stringify(provider)});\n`);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always", compaction: { enabled: false } }));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "root-capabilities-fixture": {
    api: "openai-completions", baseUrl: "https://fixture.invalid", apiKey: "fixture-no-network",
    models: [{ id: "fixture", name: "Deterministic mixed recursion", reasoning: false, input: ["text"],
      contextWindow: 100000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  const cli = join(workspace, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
  const extension = join(project, "src/poc/spinetree-runtime-extension.mjs");
  const config = { mode: "attach", root, agent: { agentId: "mixed-parent", branch: "task" },
    child: { command: process.execPath, args: ["--import", preload], piCli: cli, extension } };
  const records = join(directory, "provider-records.jsonl");
  const child = spawn(process.execPath, ["--import", preload, join(project, "src/poc/run-spinetree-pi-child.mjs"),
    "--spine-child-config", JSON.stringify({ piCli: cli, spinetree: config }),
    "--mode", "json", "--print", "--provider", "root-capabilities-fixture", "--model", "fixture", "--thinking", "off",
    "--approve", "--no-skills", "--no-extensions", "--no-context-files", "--extension", extension,
    "--session-id", "root-capabilities-mixed", "--session-dir", sessionDir,
    "--", "Validate the mixed recursive capability lifecycle and return checked evidence."], {
    cwd: directory, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_CODING_AGENT_DIR: agentDir,
      SPINETREE_CAPABILITIES_FIXTURE: JSON.stringify({ root, scripts, scriptHashes, records, overrideDescriptor, blackboard }),
      SPINE_TREE_RUNTIME_OPTIONS: JSON.stringify({ cwd: directory, agentDir, sessionDir,
        provider: "root-capabilities-fixture", model: "fixture", thinkingLevel: "off", extensionPaths: [provider],
        settings: { compaction: { enabled: false } }, resourcePublisher: true }),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 120000);
  t.after(() => { clearTimeout(timeout); if (child.exitCode === null) child.kill("SIGTERM"); });
  const ended = await new Promise((yes, no) => { child.on("error", no); child.on("exit", (code, signal) => yes({ code, signal })); });
  clearTimeout(timeout);
  await writeFile(join(directory, "stdout.jsonl"), stdout); await writeFile(join(directory, "stderr.txt"), stderr);
  assert.equal(ended.code, 0, stderr);
  const samples = (await readFile(records, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(samples.filter(item => item.failure), [], "Provider contract assertions must all pass");
  const final = store.readSnapshot(store.head());
  const bindings = Object.values(final.registry);
  assert.equal(bindings.length, 6); assert.ok(bindings.every(binding => binding.status === "ended"));
  assert.equal(new Set(samples.map(item => item.pid)).size, 5);
  assert.equal(new Set(samples.map(item => item.session)).size, 6);
  assert.deepEqual([...new Set(samples.map(item => item.role))].sort(), ["child-a", "child-b", "grandchild-a", "grandchild-b", "reexecution", "root"]);
  const reexecution = bindings.find(binding => binding.scope.startsWith("reexecution:"));
  const work = final.branches[reexecution.branch];
  assert.equal(work.status, "capped"); assert.equal(work.memoryVersion, 2); assert.equal(work.reexecution.state, "completed");
  assert.deepEqual(work.skills, [overrideDescriptor]);
  assert.deepEqual(final.branches.root.skills, basis.skills);
  assert.equal(final.branches.root.tools.length, 2); assert.equal(work.tools.length, 1);
  assert.notEqual(resourceVersion(work.tools[0]), resourceVersion(final.branches.root.tools.find(item => item.name === "measure")));
  const reSamples = samples.filter(item => item.role === "reexecution");
  const parentSamples = samples.filter(item => item.role === "child-a");
  assert.equal(reSamples[0].pid, parentSamples[0].pid);
  assert.ok(samples.filter(item => item.role.startsWith("grandchild")).every(item =>
    item.offer.skills.find(skill => skill.name === "discover-and-invoke").source === work.id));
  const spawned = Object.values(final.branches).filter(branch => branch.spawnReservation);
  assert.equal(spawned.length, 4); assert.ok(spawned.every(branch => branch.spawnReservation.state === "terminal"));
  assert.equal(spawned.filter(branch => final.branches[branch.parent]?.id === work.id).length, 2);
  const receipts = Object.values(final.mailbox.receipts);
  assert.equal(receipts.length, 1); assert.equal(receipts[0].status, "observed");
  assert.equal(receipts[0].to, reexecution.agentId);
  const count = name => samples.filter(item => item.command?.name === name).length;
  assert.equal(count("spine_spawn"), 2); assert.equal(count("spine_child_return"), 4);
  assert.equal(count("spinetree_observe"), 1); assert.equal(count("spinetree_dispatch"), 1);
  const rootSamples = samples.filter(item => item.role === "root");
  assert.equal(rootSamples.at(-1).checked.value, 14); assert.equal(rootSamples.at(-1).command, null);
  // The provider sees each committed current branch; its execution assignment
  // stays fixed while inline work keeps the identity created by its first Open.
  assert.ok(rootSamples.every(item => item.home === "task"));
  assert.equal(rootSamples[0].offer.branch, "task");
  const coordinate = rootSamples[1].offer.branch, integrate = rootSamples[5].offer.branch;
  assert.notEqual(coordinate, "task"); assert.notEqual(integrate, coordinate);
  assert.equal(final.branches[coordinate].parent, "task");
  assert.equal(final.branches[integrate].parent, coordinate);
  assert.equal(rootSamples[8].offer.branch, coordinate);
  assert.equal(rootSamples[9].offer.branch, "task");
  for (const [id, firstOffer] of [[coordinate, rootSamples[1].offer], [integrate, rootSamples[5].offer]]) {
    const first = store.readSnapshot(firstOffer.head).branches[id], completed = final.branches[id];
    assert.equal(first.status, "live"); assert.equal(completed.status, "capped");
    assert.equal(completed.memoryVersion, 1);
    for (const field of ["id", "parent", "scopeBinding", "constraints", "skills", "tools"]) {
      assert.deepEqual(completed[field], first[field]);
    }
    for (const field of ["constraints", "skills", "tools"]) assert.deepEqual(completed[field], []);
    assert.deepEqual(completed.memorySource.nodeId, first.scopeBinding.nodeId);
  }
  assert.equal(final.branches.task.scopeBinding, undefined);
  assert.equal(final.branches.task.memoryVersion, 0);
  assert.equal(final.branches.task.status, "live");
  const childHome = parentSamples[0].home, localWork = parentSamples[1].offer.branch;
  assert.equal(parentSamples[0].offer.branch, childHome, "Task floor belongs to the reserved child home");
  assert.notEqual(localWork, childHome); assert.equal(final.branches[localWork].parent, childHome);
  assert.equal(parentSamples[2].offer.branch, work.id);
  assert.equal(work.parent, localWork, "reexecution preserves the originally accepted result's parent");
  const firstVersion = store.readSnapshot(parentSamples[4].offer.head).branches[work.id];
  assert.equal(firstVersion.status, "capped"); assert.equal(firstVersion.memoryVersion, 1);
  assert.equal(work.reexecution.source.memoryVersion, 1);
  assert.deepEqual(work.reexecution.source.memorySource, firstVersion.memorySource);
  assert.deepEqual(work.reexecution.source.scopeBinding, firstVersion.scopeBinding);
  for (const branch of spawned) {
    assert.equal(branch.parent, branch.spawnReservation.parentBranch, "join never reparents a reserved child");
    assert.equal(branch.spawnReservation.handoff.to.parent, branch.parent);
  }
  for (const sample of samples) {
    const offeredState = store.readSnapshot(sample.offer.head);
    const owner = Object.values(offeredState.registry).find(item => item.sessionId === sample.session);
    assert.equal(owner.branch, sample.home);
    assert.deepEqual(owner.scopeCursor, sample.offer.scope.nodeId);
    assert.equal(owner.epoch, sample.offer.scope.epoch);
    const current = offeredState.branches[sample.offer.branch];
    assert.ok(current);
    const mapped = current.scopeBinding;
    if (owner.scopeCursor.length > 1 && mapped?.sessionId === sample.session) {
      assert.deepEqual(mapped.nodeId, owner.scopeCursor);
    } else {
      assert.equal(current.id, owner.branch, "RootEpoch and an unimported child prefix anchor the explicit assignment");
    }
  }
  let attempts = "";
  try { attempts = await readFile(networkAttempts, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  assert.equal(attempts, "");
  const files = await readdir(sessionDir, { recursive: true });
  const sessionFiles = files.filter(path => path.endsWith(".jsonl"));
  assert.equal(sessionFiles.length, 6);
  const entries = [];
  for (const path of sessionFiles) {
    const rows = (await readFile(join(sessionDir, path), "utf8")).trim().split("\n").map(JSON.parse);
    // Child sessions include parent history. Only count records after their own typed import start.
    const session = rows.find(row => row.type === "session");
    const start = rows.findIndex(row => row.customType === "spinetree.scope-import.v1" && row.data?.state === "start" && row.data.sessionId === session?.id);
    assert.ok(start >= 0, `Missing own scope import enrollment: ${path}`);
    entries.push(...rows.slice(start));
  }
  assert.equal(entries.filter(entry => entry.customType === "spine.fault.v1").length, 0);
  assert.equal(entries.filter(entry => entry.type === "message" && entry.message?.role === "assistant" &&
    ["error", "aborted"].includes(entry.message.stopReason)).length, 0);
  assert.equal(entries.filter(entry => entry.type === "message" && entry.message?.role === "assistant").length, samples.length);
  const uses = entries.filter(entry => entry.customType === "spinetree.resource-use.v1");
  const succeeded = uses.filter(item => item.data.phase === "succeeded");
  assert.equal(succeeded.filter(item => item.data.name === "measure").length, 8);
  assert.equal(succeeded.filter(item => item.data.name === "publish-resource").length, 3);
  assert.equal(uses.filter(item => item.data.phase === "failed" && item.data.name === "publish-resource").length, 1);
  assert.equal(uses.filter(item => item.data.phase === "rejected" && item.data.error?.code === "stale-resource").length, 1);
  const output = { directory, finalHead: store.head(), externalProviderRequests: 0, networkAttempts: 0,
    samples: samples.length, processes: 5, sessions: 6, spawn: count("spine_spawn"), childReturns: count("spine_child_return"),
    completedReexecutions: 1, observed: 1, workBranch: work.id, memoryVersion: work.memoryVersion,
    rootSkillVersions: basis.skills.map(item => ({ name: item.name, version: resourceVersion(item) })),
    localSkillVersion: resourceVersion(overrideDescriptor), registry: final.registry,
    ordinaryOfferScopes: new Set(samples.map(item => JSON.stringify(item.offer.scope))).size,
    toolResults: entries.filter(item => item.type === "message" && item.message?.role === "toolResult").length,
    expectedRejections: ["stale-resource", "publisher-revision-conflict", "root-endpoint-unavailable"],
    scriptExecutions: succeeded.filter(item => item.data.name === "measure").map(item => item.data),
    resourceUses: { succeeded: uses.filter(item => item.data.phase === "succeeded").length,
      failed: uses.filter(item => item.data.phase === "failed").length, rejected: uses.filter(item => item.data.phase === "rejected").length },
    sourceFiles: await Promise.all([provider, fileURLToPath(import.meta.url), extension,
      join(project, "src/poc/spinetree-root-capabilities.mjs"), join(project, "src/poc/spinetree-pi-runtime.mjs"),
      join(project, "src/poc/pi-plugin-extension.mjs"), join(project, "src/poc/spinetree-execution.mjs"),
      join(project, "src/poc/spinetree-resources.mjs"), join(project, "src/poc/spinetree-resource-publisher.mjs"),
      join(project, "src/poc/run-spinetree-pi-child.mjs"), cli,
      join(workspace, "packages/spinetree-plugin/dist/index.js")].map(async path =>
      ({ path, sha256: digest(await readFile(path)) }))),
  };
  await writeFile(join(directory, "result.json"), JSON.stringify(output, null, 2) + "\n");
});
