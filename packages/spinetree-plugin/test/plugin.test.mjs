import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSpineTreePlugin,
  MemorySpineTreeStore,
  SPINETREE_PLUGIN_MANIFEST,
  SPINETREE_CHANGE_RESULT_SCHEMA,
  SPINETREE_READ_RESULT_SCHEMA,
  SPINETREE_OBSERVE_RESULT_SCHEMA,
  SpineTreeChangeError,
  SpineTreeReadError,
  SpineTreeObserveError,
  MemoryAgentRegistry,
  GitSpineTreeAgentRegistry,
  MemorySpineTreeMailbox,
  GitSpineTreeMailbox,
  SpineTreeRegistryError,
  SpineTreeSendError,
  SPINETREE_SEND_RESULT_SCHEMA,
  GitSpineTreeStore,
  SpineTreeGitStoreError,
} from "../dist/index.js";
import { SpinePluginHost } from "@spinejit/spine-host";
import { createPiSessionAdapter } from "@spinejit/spine-host/pi";

const canonicalPlugin = {
  manifest: {
    schema: "spine-host/v1",
    id: "@spinejit/spine-plugin",
    version: "0.1.0",
    owns: ["spine.canonical"],
  },
  activate() {},
};

test("declares an ordinary Pi project coordination plugin", () => {
  assert.equal(SPINETREE_PLUGIN_MANIFEST.schema, "spine-host/v1");
  assert.equal(SPINETREE_PLUGIN_MANIFEST.id, "@spinetree/plugin");
  assert.deepEqual(SPINETREE_PLUGIN_MANIFEST.requires, ["@spinejit/spine-plugin"]);
  assert.deepEqual(SPINETREE_PLUGIN_MANIFEST.owns, ["spinetree.project-state"]);
  assert.equal(SPINETREE_PLUGIN_MANIFEST.toolNamespace, "spinetree");
  assert.equal(SPINETREE_PLUGIN_MANIFEST.storageNamespace, "spinetree");
  assert.equal(createSpineTreePlugin().manifest, SPINETREE_PLUGIN_MANIFEST);
});

test("reads one fixed HEAD snapshot with inheritance, children, and binding", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: ["ship"],
        skills: ["typescript"],
        tools: [{ name: "build", command: "npm test" }],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "live",
      },
      child: {
        id: "child",
        parent: "root",
        goal: "feature",
        constraints: ["focused"],
        skills: ["typescript", "testing"],
        tools: [{ name: "build", command: "npm run check" }],
        memory: "child memory",
        memoryVersion: 2,
        memorySource: { agent: "a_child", memoryVersion: 2 },
        status: "live",
      },
      leaf: {
        id: "leaf",
        parent: "child",
        goal: "leaf",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {
      a_root: { id: "a_root", working: "child", live: ["root", "child"], status: "running" },
      a_child: { id: "a_child", working: "leaf", live: ["leaf"], status: "running" },
      a_ended: { id: "a_ended", working: "child", live: ["child"], status: "ended" },
    },
    registry: {
      current: { agentId: "current", sessionId: "session-child", branch: "child", scope: "scope-2", status: "paused" },
    },
  };
  const calls = [];
  const store = {
    head() {
      calls.push(["head"]);
      return "head-7";
    },
    readSnapshot(head) {
      calls.push(["readSnapshot", head]);
      return snapshot;
    },
  };
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ store }));
  await host.activateAll();

  const before = JSON.stringify(snapshot);
  const result = await host.executeTool("spinetree_read", { branch: "child" });
  assert.deepEqual(result, {
    schema: SPINETREE_READ_RESULT_SCHEMA,
    head: "head-7",
    branch: snapshot.branches.child,
    inherit: {
      path: ["root", "child"],
      constraints: [
        { value: "ship", source: "root" },
        { value: "focused", source: "child" },
      ],
      skills: [
        { value: "typescript", source: "child" },
        { value: "testing", source: "child" },
      ],
      tools: [
        { value: { name: "build", command: "npm run check" }, source: "child" },
      ],
      memories: [
        { branch: "root", memory: null, memoryVersion: 0 },
        { branch: "child", memory: "child memory", memoryVersion: 2 },
      ],
    },
    children: ["leaf"],
    binding: snapshot.registry.current,
  });
  assert.deepEqual(calls, [["head"], ["readSnapshot", "head-7"]]);
  assert.equal(JSON.stringify(snapshot), before);

  const repeated = await host.executeTool("spinetree_read", { branch: "child" });
  assert.deepEqual(repeated, result);
  await host.dispose();
});

test("reports unknown branches as a typed read error", async () => {
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({
    store: {
      head: () => "head-1",
      readSnapshot: () => ({ branches: {}, agents: {} }),
    },
  }));
  await host.activateAll();
  await assert.rejects(
    host.executeTool("spinetree_read", { branch: "missing" }),
    error => error instanceof SpineTreeReadError && error.code === "unknown-branch",
  );
  await host.dispose();
});

test("changes an immutable memory snapshot with a strict HEAD CAS", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
      child: {
        id: "child",
        parent: "root",
        goal: "old",
        constraints: [],
        skills: [],
        tools: [],
        memory: "done",
        memoryVersion: 1,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {},
  };
  const store = new MemorySpineTreeStore(snapshot);
  const initialHead = store.head();
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ store }));
  await host.activateAll();

  const result = await host.executeTool("spinetree_change", {
    expectedHead: initialHead,
    changes: [
      { type: "update", branch: "child", attributes: { goal: "new", skills: ["testing"] } },
      { type: "archive", branch: "child" },
    ],
  });
  assert.deepEqual(result, {
    schema: SPINETREE_CHANGE_RESULT_SCHEMA,
    parent: initialHead,
    head: "memory-1",
    changes: [
      { type: "update", branch: "child", attributes: { goal: "new", skills: ["testing"] } },
      { type: "archive", branch: "child" },
    ],
  });
  assert.equal(store.head(), "memory-1");
  assert.equal(store.readSnapshot(initialHead).branches.child.goal, "old");
  assert.equal(store.readSnapshot(initialHead).branches.child.status, "capped");
  assert.equal(store.readSnapshot("memory-1").branches.child.goal, "new");
  assert.equal(store.readSnapshot("memory-1").branches.child.status, "archived");

  await assert.rejects(
    host.executeTool("spinetree_change", {
      expectedHead: initialHead,
      changes: [{ type: "update", branch: "root", attributes: { goal: "stale" } }],
    }),
    error => error instanceof SpineTreeChangeError && error.code === "stale-head",
  );
  assert.equal(store.head(), "memory-1");
  await host.dispose();
});

test("rejects an invalid change batch atomically and keeps read-only stores contract-only", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {},
  };
  const store = new MemorySpineTreeStore(snapshot);
  const head = store.head();
  assert.throws(
    () => store.change(head, [
      { type: "update", branch: "root", attributes: { goal: "draft" } },
      { type: "update", branch: "root", attributes: { memory: "forbidden" } },
    ]),
    error => error instanceof SpineTreeChangeError && error.code === "invalid-change",
  );
  assert.equal(store.head(), head);
  assert.equal(store.readSnapshot(head).branches.root.goal, "project");

  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({
    store: {
      head: () => head,
      readSnapshot: () => snapshot,
    },
  }));
  await host.activateAll();
  assert.deepEqual(await host.executeTool("spinetree_change", { expectedHead: head, changes: [] }), {
    schema: "spinetree.operation.result/v1",
    operation: "change",
    status: "contract-only",
    storageNamespace: "spinetree",
  });
  await host.dispose();
});

test("enforces move cycles, root/live guards, and archive live-work guards", () => {
  const snapshot = {
    branches: {
      root: { id: "root", parent: null, goal: "root", constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null, status: "capped" },
      capped: { id: "capped", parent: "root", goal: "capped", constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null, status: "capped" },
      descendant: { id: "descendant", parent: "capped", goal: "descendant", constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null, status: "capped" },
      live: { id: "live", parent: "root", goal: "live", constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null, status: "live" },
    },
    agents: {},
  };
  const store = new MemorySpineTreeStore(snapshot);
  const head = store.head();
  for (const changes of [
    [{ type: "move", branch: "capped", parent: "descendant" }],
    [{ type: "move", branch: "root", parent: "capped" }],
    [{ type: "move", branch: "live", parent: "capped" }],
    [{ type: "archive", branch: "root" }],
  ]) {
    assert.throws(
      () => store.change(head, changes),
      error => error instanceof SpineTreeChangeError && error.code === "invalid-change",
    );
    assert.equal(store.head(), head);
  }
  const result = store.change(head, [{ type: "archive", branch: "capped" }]);
  assert.equal(result.parent, head);
  assert.equal(store.readSnapshot(result.head).branches.capped.status, "archived");
});

test("persists immutable snapshots in an explicit `.spinetree` Git root with CAS HEAD", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
      child: {
        id: "child",
        parent: "root",
        goal: "old",
        constraints: [],
        skills: [],
        tools: [],
        memory: "done",
        memoryVersion: 1,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const initialHead = store.head();
  assert.match(initialHead, /^[0-9a-f]{40}$/);
  assert.deepEqual(store.readSnapshot(initialHead), snapshot);

  const changed = store.change(initialHead, [{
    type: "update",
    branch: "child",
    attributes: { goal: "new", skills: ["testing"] },
  }]);
  assert.equal(changed.parent, initialHead);
  assert.match(changed.head, /^[0-9a-f]{40}$/);
  assert.notEqual(changed.head, initialHead);
  assert.equal(store.head(), changed.head);
  assert.equal(store.readSnapshot(initialHead).branches.child.goal, "old");
  assert.equal(store.readSnapshot(changed.head).branches.child.goal, "new");

  const reloaded = new GitSpineTreeStore(root);
  assert.equal(reloaded.head(), changed.head);
  assert.equal(reloaded.readSnapshot(changed.head).branches.child.skills[0], "testing");
  assert.throws(
    () => GitSpineTreeStore.initialize(root, snapshot),
    error => error instanceof SpineTreeGitStoreError && error.code === "invalid-root",
  );
  assert.throws(
    () => reloaded.change(initialHead, [{ type: "update", branch: "root", attributes: { goal: "stale" } }]),
    error => error instanceof SpineTreeChangeError && error.code === "stale-head",
  );
  assert.equal(reloaded.head(), changed.head);
});

test("separate Git store processes enforce one expected-HEAD winner", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-race-"));
  const first = GitSpineTreeStore.initialize(root, snapshot);
  const second = new GitSpineTreeStore(root);
  const expectedHead = first.head();
  const firstResult = first.change(expectedHead, [{
    type: "update",
    branch: "root",
    attributes: { goal: "first" },
  }]);
  const childScript = `
    import { GitSpineTreeStore, SpineTreeChangeError } from './dist/index.js';
    const store = new GitSpineTreeStore(process.env.SPINE_ROOT);
    try {
      store.change(process.env.SPINE_HEAD, [{ type: 'update', branch: 'root', attributes: { goal: 'second' } }]);
      process.exit(2);
    } catch (error) {
      if (error instanceof SpineTreeChangeError && error.code === 'stale-head') process.stdout.write('stale-head');
      else process.exit(3);
    }
  `;
  const childResult = execFileSync(process.execPath, ["--input-type=module", "-e", childScript], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, SPINE_ROOT: root, SPINE_HEAD: expectedHead },
    encoding: "utf8",
  });
  assert.equal(childResult, "stale-head");
  assert.equal(second.head(), firstResult.head);
  assert.equal(second.readSnapshot(firstResult.head).branches.root.goal, "first");
});

test("Git snapshot validation and failed batches do not move HEAD", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root",
        parent: null,
        goal: "project",
        constraints: [],
        skills: [],
        tools: [],
        memory: null,
        memoryVersion: 0,
        memorySource: null,
        status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-invalid-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const head = store.head();
  assert.throws(
    () => store.change(head, [
      { type: "update", branch: "root", attributes: { goal: "draft" } },
      { type: "update", branch: "root", attributes: { memory: "forbidden" } },
    ]),
    error => error instanceof SpineTreeChangeError && error.code === "invalid-change",
  );
  assert.equal(store.head(), head);
  assert.equal(store.readSnapshot(head).branches.root.goal, "project");
  assert.throws(
    () => new GitSpineTreeStore(join(root, "missing")),
    error => error instanceof SpineTreeGitStoreError && error.code === "not-initialized",
  );
});

test("Git registry survives reload and preserves concurrent registrations", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root", parent: null, goal: "project", constraints: [], skills: [], tools: [],
        memory: null, memoryVersion: 0, memorySource: null, status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-registry-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const registry = new GitSpineTreeAgentRegistry(store);
  await registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "root", status: "running" });

  const childScript = `
    import { GitSpineTreeAgentRegistry } from './dist/index.js';
    const registry = new GitSpineTreeAgentRegistry(process.env.SPINE_ROOT);
    await registry.register({ agentId: 'agent-2', sessionId: 'session-2', branch: 'root', status: 'paused' });
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", childScript], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, SPINE_ROOT: root },
  });

  const reloaded = new GitSpineTreeAgentRegistry(new GitSpineTreeStore(root));
  assert.deepEqual(await reloaded.resolve("agent-1"), {
    agentId: "agent-1", sessionId: "session-1", branch: "root", status: "running",
  });
  assert.deepEqual(await reloaded.resolve("agent-2"), {
    agentId: "agent-2", sessionId: "session-2", branch: "root", status: "paused",
  });
  await assert.rejects(
    reloaded.register({ agentId: "agent-1", sessionId: "other", branch: "root", status: "running" }),
    error => error instanceof SpineTreeRegistryError && error.code === "duplicate-agent",
  );
});

test("Git mailbox persists receipts, leases and idempotency across reload", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root", parent: null, goal: "project", constraints: [], skills: [], tools: [],
        memory: null, memoryVersion: 0, memorySource: null, status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-mailbox-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const mailbox = new GitSpineTreeMailbox(store);
  const queued = await mailbox.enqueue({ to: "agent-1", from: null, message: "hello", requestId: "req-1" });
  assert.equal(queued.id, "mail-1");

  const reloaded = new GitSpineTreeMailbox(new GitSpineTreeStore(root));
  assert.deepEqual(await reloaded.enqueue({ to: "agent-1", from: null, message: "hello", requestId: "req-1" }), queued);
  const leased = await reloaded.lease(queued.id);
  assert.equal(leased.status, "leased");
  assert.equal(leased.attempt, 1);
  const delivered = await mailbox.delivered(leased.id, leased.leaseId);
  assert.equal(delivered.status, "delivered");
  assert.equal((await reloaded.receipt(leased.id)).status, "delivered");
  assert.equal((await reloaded.observed(leased.id)).status, "observed");
  await assert.rejects(
    reloaded.lease(leased.id),
    error => error.code === "invalid-state",
  );
});

test("Git mailbox reclaims an expired lease with a new lease ID", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root", parent: null, goal: "project", constraints: [], skills: [], tools: [],
        memory: null, memoryVersion: 0, memorySource: null, status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-mailbox-expired-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const mailbox = new GitSpineTreeMailbox(store);
  const queued = await mailbox.enqueue({ to: "agent-1", from: null, message: "retry" });
  const leased = await mailbox.lease(queued.id);
  const head = store.head();
  const current = store.readSnapshot(head);
  const expired = {
    ...current,
    mailbox: {
      ...current.mailbox,
      receipts: {
        ...current.mailbox.receipts,
        [leased.id]: { ...leased, leaseUntil: Date.now() - 1 },
      },
    },
  };
  store.commitSnapshot(head, expired, "test: expire mailbox lease");
  const reclaimed = await new GitSpineTreeMailbox(store).lease(leased.id);
  assert.equal(reclaimed.status, "leased");
  assert.equal(reclaimed.attempt, 2);
  assert.notEqual(reclaimed.leaseId, leased.leaseId);
});

test("wires Git registry and mailbox persistence through the SpineTree send tool", async () => {
  const snapshot = {
    branches: {
      root: {
        id: "root", parent: null, goal: "project", constraints: [], skills: [], tools: [],
        memory: null, memoryVersion: 0, memorySource: null, status: "capped",
      },
    },
    agents: {},
  };
  const root = await mkdtemp(join(tmpdir(), "spinetree-git-send-"));
  const store = GitSpineTreeStore.initialize(root, snapshot);
  const registry = new GitSpineTreeAgentRegistry(store);
  const mailbox = new GitSpineTreeMailbox(store);
  await registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "root", status: "running" });

  const requests = [];
  const host = new SpinePluginHost({
    sessions: {
      async request(request) {
        requests.push(request);
        return { accepted: true };
      },
    },
  });
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ store, registry, mailbox }));
  await host.activateAll();

  const result = await host.executeTool("spinetree_send", {
    to: "agent-1", message: "persisted hello", requestId: "req-persisted",
  });
  assert.equal(result.status, "delivered");
  assert.deepEqual(requests, [{
    targetSessionId: "session-1",
    operation: "prompt",
    text: "persisted hello",
    requestId: "mail-1",
  }]);
  await host.dispose();

  const reloadedRegistry = new GitSpineTreeAgentRegistry(new GitSpineTreeStore(root));
  const reloadedMailbox = new GitSpineTreeMailbox(new GitSpineTreeStore(root));
  assert.deepEqual(await reloadedRegistry.resolve("agent-1"), {
    agentId: "agent-1", sessionId: "session-1", branch: "root", status: "running",
  });
  assert.equal((await reloadedMailbox.receipt("mail-1")).status, "delivered");
  assert.deepEqual(
    await reloadedMailbox.enqueue({
      to: "agent-1", from: null, message: "persisted hello", requestId: "req-persisted",
    }),
    result.receipt,
  );

  const observeHost = new SpinePluginHost();
  observeHost.register(canonicalPlugin);
  observeHost.register(createSpineTreePlugin({
    registry: reloadedRegistry,
    mailbox: reloadedMailbox,
  }));
  await observeHost.activateAll();
  const observed = await observeHost.executeTool("spinetree_observe", {
    receiptId: "mail-1",
    agentId: "agent-1",
  });
  assert.deepEqual(observed, {
    schema: SPINETREE_OBSERVE_RESULT_SCHEMA,
    receipt: { ...result.receipt, status: "observed" },
    agentId: "agent-1",
    sessionId: "session-1",
  });
  await observeHost.dispose();
  assert.equal((await new GitSpineTreeMailbox(new GitSpineTreeStore(root)).receipt("mail-1")).status, "observed");
});

test("observes only delivered receipts for their registered recipient and is idempotent", async () => {
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "root", status: "running" });
  registry.register({ agentId: "agent-2", sessionId: "session-2", branch: "root", status: "paused" });
  const mailbox = new MemorySpineTreeMailbox();
  const queued = mailbox.enqueue({ to: "agent-1", from: null, message: "queued" });
  const delivered = mailbox.delivered(queued.id, mailbox.lease(queued.id).leaseId);

  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ registry, mailbox }));
  await host.activateAll();

  const result = await host.executeTool("spinetree_observe", {
    receiptId: delivered.id,
    agentId: "agent-1",
  });
  assert.deepEqual(result, {
    schema: SPINETREE_OBSERVE_RESULT_SCHEMA,
    receipt: { ...delivered, status: "observed" },
    agentId: "agent-1",
    sessionId: "session-1",
  });
  assert.deepEqual(await host.executeTool("spinetree_observe", {
    receiptId: delivered.id,
    agentId: "agent-1",
  }), result);
  await assert.rejects(
    host.executeTool("spinetree_observe", { receiptId: delivered.id, agentId: "agent-2" }),
    error => error instanceof SpineTreeObserveError && error.code === "not-recipient",
  );

  const pending = mailbox.enqueue({ to: "agent-1", from: null, message: "pending" });
  await assert.rejects(
    host.executeTool("spinetree_observe", { receiptId: pending.id, agentId: "agent-1" }),
    error => error instanceof SpineTreeObserveError && error.code === "invalid-state",
  );
  await host.dispose();
});

test("sends through a registered Agent session and preserves idempotent receipts", async () => {
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "child", status: "running" });
  const mailbox = new MemorySpineTreeMailbox();
  const requests = [];
  const host = new SpinePluginHost({
    sessions: {
      async request(request) {
        requests.push(request);
        return { accepted: true, requestId: request.requestId };
      },
    },
  });
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ registry, mailbox }));
  await host.activateAll();

  const result = await host.executeTool("spinetree_send", {
    to: "agent-1",
    from: undefined,
    message: "hello",
    requestId: "req-1",
  });
  assert.equal(result.schema, SPINETREE_SEND_RESULT_SCHEMA);
  assert.equal(result.status, "delivered");
  assert.equal(result.receipt.id, "mail-1");
  assert.equal(result.receipt.attempt, 1);
  assert.equal(result.receipt.status, "delivered");
  assert.deepEqual(requests, [{
    targetSessionId: "session-1",
    operation: "prompt",
    text: "hello",
    requestId: "mail-1",
  }]);

  const repeated = await host.executeTool("spinetree_send", {
    to: "agent-1", message: "hello", requestId: "req-1",
  });
  assert.equal(repeated.receipt.id, "mail-1");
  assert.equal(requests.length, 1);
  const observed = mailbox.observed("mail-1");
  assert.equal(observed.status, "observed");
  assert.equal(mailbox.observed("mail-1").status, "observed");
  assert.throws(
    () => mailbox.enqueue({ to: "agent-1", from: null, message: "different", requestId: "req-1" }),
    error => error.code === "invalid-state",
  );
  await host.dispose();
});

test("requeues rejected or failed session delivery without losing the receipt", async () => {
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "child", status: "running" });
  const mailbox = new MemorySpineTreeMailbox();
  let mode = "reject";
  const host = new SpinePluginHost({
    sessions: {
      async request() {
        if (mode === "reject") return { accepted: false };
        throw new Error("temporary outage");
      },
    },
  });
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ registry, mailbox }));
  await host.activateAll();

  const rejected = await host.executeTool("spinetree_send", { to: "agent-1", message: "one", requestId: "req-1" });
  assert.equal(rejected.status, "queued");
  assert.equal(rejected.receipt.status, "queued");
  assert.equal(rejected.receipt.attempt, 1);
  assert.equal(rejected.receipt.lastError, "session request was not accepted");

  mode = "error";
  const retried = await host.executeTool("spinetree_send", { to: "agent-1", message: "one", requestId: "req-1" });
  assert.equal(retried.receipt.id, rejected.receipt.id);
  assert.equal(retried.receipt.attempt, 2);
  assert.equal(retried.receipt.status, "queued");
  assert.equal(retried.receipt.lastError, "temporary outage");
  await host.dispose();
});

test("send keeps a receipt leased until the Pi command resolves, then suppresses local redelivery", async (t) => {
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "child", status: "running" });
  const mailbox = new MemorySpineTreeMailbox();
  const started = Promise.withResolvers();
  const completed = Promise.withResolvers();
  const calls = [];
  const lease = {
    id: "session-1", active: true,
    async prompt(...args) {
      calls.push([this.id, args]);
      started.resolve();
      return completed.promise;
    },
    async steer() { assert.fail("send must use prompt"); },
    async dispose() { assert.fail("lease belongs to the caller"); },
  };
  const host = new SpinePluginHost({
    sessions: createPiSessionAdapter(id => {
      assert.equal(id, "session-1");
      return lease;
    }),
  });
  t.after(() => host.dispose());
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ registry, mailbox }));
  await host.activateAll();

  const input = { to: "agent-1", message: "hello", requestId: "caller-1" };
  let settled = false;
  const sending = host.executeTool("spinetree_send", input).then(result => {
    settled = true;
    return result;
  });
  await started.promise;
  assert.equal(settled, false);
  assert.equal(mailbox.receipt("mail-1").status, "leased");
  assert.equal(mailbox.receipt("mail-1").attempt, 1);
  assert.deepEqual(calls, [["session-1", ["hello"]]]);

  completed.resolve({ id: "session-1" });
  const result = await sending;
  assert.equal(result.status, "delivered");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.receipt.status, "delivered");
  assert.equal(result.receipt.leaseId, null);
  assert.deepEqual(await host.executeTool("spinetree_send", input), result);
  assert.equal(calls.length, 1);
  assert.equal(mailbox.receipt(result.receipt.id).status, "delivered");
});

test("send retries one receipt across unavailable leases, Pi rejection and transport failure", async (t) => {
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-1", sessionId: "session-1", branch: "child", status: "running" });
  const mailbox = new MemorySpineTreeMailbox();
  let mode = "missing";
  const calls = [];
  const lease = {
    id: "session-1",
    get active() { return mode !== "inactive"; },
    async prompt(...args) {
      calls.push([mode, args]);
      if (mode === "disconnected") throw new Error("connection lost before acknowledgement");
      if (mode !== "ready") throw Object.assign(new Error(mode), { name: "PiServerError", code: mode });
      return { id: "session-1" };
    },
    async steer() { assert.fail("send must use prompt"); },
  };
  const host = new SpinePluginHost({
    sessions: createPiSessionAdapter(() => mode === "missing" ? undefined : lease),
  });
  t.after(() => host.dispose());
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ registry, mailbox }));
  await host.activateAll();

  const input = { to: "agent-1", message: "hello", requestId: "caller-1" };
  let attempt = 0;
  for (const nextMode of ["missing", "inactive", "busy", "session_locked", "disconnected", "invalid_request"]) {
    mode = nextMode;
    const result = await host.executeTool("spinetree_send", input);
    assert.equal(result.receipt.id, "mail-1");
    assert.equal(result.receipt.requestId, "caller-1");
    assert.equal(result.receipt.attempt, ++attempt);
    assert.equal(result.status, "queued");
    assert.equal(result.receipt.status, "queued");
    assert.equal(result.receipt.leaseId, null);
    assert.equal(result.receipt.lastError,
      mode === "disconnected" ? "connection lost before acknowledgement"
        : mode === "invalid_request" ? "invalid_request" : "session request was not accepted");
  }
  mode = "ready";
  const delivered = await host.executeTool("spinetree_send", input);
  assert.equal(delivered.receipt.id, "mail-1");
  assert.equal(delivered.receipt.attempt, ++attempt);
  assert.equal(delivered.status, "delivered");
  assert.deepEqual(calls, ["busy", "session_locked", "disconnected", "invalid_request", "ready"]
    .map(mode => [mode, ["hello"]]));
});

test("validates Agent addresses and keeps send contract-only without explicit dependencies", async () => {
  const registry = new MemoryAgentRegistry();
  assert.throws(
    () => registry.register({ agentId: "", sessionId: "s", branch: "b", status: "running" }),
    error => error instanceof SpineTreeRegistryError && error.code === "invalid-binding",
  );
  registry.register({ agentId: "ended", sessionId: "s-ended", branch: "b", status: "ended" });
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin());
  await host.activateAll();
  assert.deepEqual(await host.executeTool("spinetree_send", { to: "anything", message: "hello" }), {
    schema: "spinetree.operation.result/v1",
    operation: "send",
    status: "contract-only",
    storageNamespace: "spinetree",
  });
  assert.deepEqual(await host.executeTool("spinetree_observe", {}), {
    schema: "spinetree.operation.result/v1",
    operation: "observe",
    status: "contract-only",
    storageNamespace: "spinetree",
  });
  await host.dispose();

  const sendHost = new SpinePluginHost();
  sendHost.register(canonicalPlugin);
  sendHost.register(createSpineTreePlugin({ registry, mailbox: new MemorySpineTreeMailbox() }));
  await sendHost.activateAll();
  await assert.rejects(
    sendHost.executeTool("spinetree_send", { to: "missing", message: "hello" }),
    error => error instanceof SpineTreeSendError && error.code === "unknown-recipient",
  );
  await assert.rejects(
    sendHost.executeTool("spinetree_send", { to: "ended", message: "hello" }),
    error => error instanceof SpineTreeSendError && error.code === "recipient-ended",
  );
  await sendHost.dispose();
});
