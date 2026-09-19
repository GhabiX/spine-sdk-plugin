import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpineTreePlugin,
  SPINETREE_PLUGIN_MANIFEST,
  SPINETREE_READ_RESULT_SCHEMA,
  SpineTreeReadError,
} from "../dist/index.js";
import { SpinePluginHost } from "@spinejit/spine-host";

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
    binding: { agent: "a_root", working: "child", live: ["root", "child"] },
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
