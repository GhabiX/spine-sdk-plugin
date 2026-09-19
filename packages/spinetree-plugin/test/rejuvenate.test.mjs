import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSpineTreePlugin,
  GitSpineTreeAgentRegistry,
  GitSpineTreeStore,
  MemoryAgentRegistry,
  MemorySpineTreeStore,
  SPINETREE_REJUVENATE_RESULT_SCHEMA,
  SpineTreeRejuvenateError,
} from "../dist/index.js";
import { SpinePluginHost } from "@spinejit/spine-host";

const canonicalPlugin = {
  manifest: { schema: "spine-host/v1", id: "@spinejit/spine-plugin", version: "0.1.0", owns: ["spine.canonical"] },
  activate() {},
};

function snapshot() {
  return {
    branches: {
      root: { id: "root", parent: null, goal: "project", constraints: ["c0"], skills: ["s0"], tools: ["t0"], memory: "root-memory", memoryVersion: 1, memorySource: "root-scope", status: "capped" },
      child: { id: "child", parent: "root", goal: "child goal", constraints: ["c1"], skills: ["s1"], tools: ["t1"], memory: "child-memory", memoryVersion: 2, memorySource: "child-scope", status: "capped" },
      live: { id: "live", parent: "root", goal: "live", constraints: [], skills: [], tools: [], memory: null, memoryVersion: 0, memorySource: null, status: "live" },
    },
    agents: {},
  };
}

async function hostFor(store, registry, rejuvenator) {
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ store, registry, rejuvenator }));
  await host.activateAll();
  return host;
}

test("rejuvenates a capped branch through an explicit provisioner", async () => {
  const store = new MemorySpineTreeStore(snapshot());
  const registry = new MemoryAgentRegistry();
  let received;
  const host = await hostFor(store, registry, {
    async provision(context) {
      received = context;
      return { agentId: "agent-child", sessionId: "session-child", branch: "child", scope: "scope-new", status: "running" };
    },
  });

  const result = await host.executeTool("spinetree_rejuvenate", {
    parent: "root", branch: "child", request: "continue from the saved memory",
  });
  assert.equal(result.schema, SPINETREE_REJUVENATE_RESULT_SCHEMA);
  assert.deepEqual(result.binding, {
    agentId: "agent-child", sessionId: "session-child", branch: "child", scope: "scope-new", status: "running",
  });
  assert.equal(received.parent.id, "root");
  assert.equal(received.branch.id, "child");
  assert.deepEqual(received.inherit.path, ["root", "child"]);
  assert.equal(received.inherit.memories[1].memory, "child-memory");
  assert.equal(received.request, "continue from the saved memory");
  assert.deepEqual(await registry.list("child"), [result.binding]);
  await host.dispose();
});

test("rejuvenate remains contract-only without all explicit adapters", async () => {
  const store = new MemorySpineTreeStore(snapshot());
  const host = new SpinePluginHost();
  host.register(canonicalPlugin);
  host.register(createSpineTreePlugin({ store }));
  await host.activateAll();
  assert.deepEqual(await host.executeTool("spinetree_rejuvenate", { parent: "root", branch: "child" }), {
    schema: "spinetree.operation.result/v1",
    operation: "rejuvenate",
    status: "contract-only",
    storageNamespace: "spinetree",
  });
  await host.dispose();
});

test("rejects non-capped, invalid-parent, and occupied branches before provisioning", async () => {
  const store = new MemorySpineTreeStore(snapshot());
  const registry = new MemoryAgentRegistry();
  registry.register({ agentId: "agent-live", sessionId: "session-live", branch: "live", status: "running" });
  let calls = 0;
  const host = await hostFor(store, registry, { provision: async () => { calls += 1; throw new Error("must not provision"); } });

  await assert.rejects(
    host.executeTool("spinetree_rejuvenate", { parent: "root", branch: "live" }),
    error => error instanceof SpineTreeRejuvenateError && error.code === "branch-not-capped",
  );
  await assert.rejects(
    host.executeTool("spinetree_rejuvenate", { parent: "live", branch: "child" }),
    error => error instanceof SpineTreeRejuvenateError && error.code === "invalid-parent",
  );
  registry.register({ agentId: "agent-child", sessionId: "session-child", branch: "child", status: "running" });
  await assert.rejects(
    host.executeTool("spinetree_rejuvenate", { parent: "root", branch: "child" }),
    error => error instanceof SpineTreeRejuvenateError && error.code === "branch-occupied",
  );
  assert.equal(calls, 0);
  await host.dispose();
});

test("Git registry persists rejuvenation binding and rejects a second active binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "spinetree-rejuvenate-git-"));
  const store = GitSpineTreeStore.initialize(root, snapshot());
  const registry = new GitSpineTreeAgentRegistry(store);
  const host = await hostFor(store, registry, {
    provision: async () => ({ agentId: "agent-child", sessionId: "session-child", branch: "child", status: "running" }),
  });
  const result = await host.executeTool("spinetree_rejuvenate", { parent: "root", branch: "child" });
  assert.equal(result.binding.agentId, "agent-child");
  await host.dispose();

  const reloaded = new GitSpineTreeAgentRegistry(new GitSpineTreeStore(root));
  assert.deepEqual(await reloaded.list("child"), [result.binding]);
  await assert.rejects(
    reloaded.registerExclusive({ agentId: "agent-other", sessionId: "session-other", branch: "child", status: "paused" }),
    error => error.code === "branch-occupied",
  );
});
