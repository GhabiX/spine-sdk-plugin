import assert from "node:assert/strict";
import test from "node:test";

import {
  SpinePluginHost,
  SpinePluginHostError,
} from "../dist/index.js";

const canonicalManifest = {
  schema: "spine-host/v1",
  id: "@spinejit/spine-plugin",
  version: "0.1.0",
  owns: ["spine.canonical"],
  toolNamespace: "spine",
  storageNamespace: "spine",
};

const projectManifest = {
  schema: "spine-host/v1",
  id: "@spinetree/plugin",
  version: "0.1.0",
  requires: ["@spinejit/spine-plugin"],
  owns: ["spinetree.project-state"],
  toolNamespace: "spinetree",
  commandNamespace: "spinetree",
  storageNamespace: "spinetree",
};

function canonicalPlugin(options = {}) {
  return {
    manifest: canonicalManifest,
    activate(context) {
      context.tools.register("open", {
        description: "Canonical Spine open placeholder",
        execute: async () => ({ status: "canonical" }),
      });
      options.activate?.(context);
    },
  };
}

function projectPlugin(options = {}) {
  return {
    manifest: projectManifest,
    activate(context) {
      for (const localName of ["read", "change", "send", "rejuvenate"]) {
        context.tools.register(localName, {
          description: `Project ${localName}`,
          execute: async () => ({ status: "contract-only", operation: localName }),
        });
      }
      context.commands.register("status", {
        description: "Project status",
        execute: async () => ({ status: "contract-only" }),
      });
      options.activate?.(context);
    },
  };
}

test("loads canonical and SpineTree plugins in dependency order", async () => {
  const host = new SpinePluginHost();
  host.register(projectPlugin());
  host.register(canonicalPlugin());

  assert.deepEqual(host.listPlugins(), ["@spinetree/plugin", "@spinejit/spine-plugin"]);
  await host.activateAll();

  assert.deepEqual(host.listTools(), [
    "spine_open",
    "spinetree_change",
    "spinetree_read",
    "spinetree_rejuvenate",
    "spinetree_send",
  ]);
  assert.deepEqual(host.listCommands(), ["spinetree:status"]);
  assert.deepEqual(await host.executeTool("spinetree_read", {}), {
    operation: "read",
    status: "contract-only",
  });
  assert.deepEqual(await host.executeCommand("spinetree:status"), { status: "contract-only" });
  await host.dispose();
});

test("rejects a second canonical owner before activation", () => {
  const host = new SpinePluginHost();
  host.register(canonicalPlugin());
  assert.throws(
    () => host.register({
      manifest: {
        ...canonicalManifest,
        id: "other-canonical",
      },
      activate() {},
    }),
    (error) => error instanceof SpinePluginHostError && error.code === "owner-conflict",
  );
});

test("isolates tool and storage namespaces between plugins", async () => {
  let otherStorageValue;
  const host = new SpinePluginHost();
  host.register(canonicalPlugin({
    activate(context) {
      context.storage.set("secret", "canonical");
    },
  }));
  host.register({
    manifest: {
      ...projectManifest,
      id: "@example/ordinary-plugin",
      requires: ["@spinejit/spine-plugin"],
      owns: [],
      toolNamespace: "example",
      storageNamespace: "example",
    },
    activate(context) {
      otherStorageValue = context.storage.get("secret");
      context.tools.register("probe", {
        description: "Namespace probe",
        execute: async () => context.storage.keys(),
      });
    },
  });
  await host.activateAll();

  assert.equal(otherStorageValue, undefined);
  assert.deepEqual(host.listTools(), ["example_probe", "spine_open"]);
  assert.deepEqual(await host.executeTool("example_probe", {}), []);
});

test("events are observable and payloads are immutable", async () => {
  const host = new SpinePluginHost();
  let observed;
  host.register({
    manifest: {
      schema: "spine-host/v1",
      id: "observer",
      version: "0.1.0",
      storageNamespace: "observer",
    },
    activate(context) {
      context.events.observe("spine.scope.commit", (event) => {
        observed = event;
      });
    },
  });
  await host.activateAll();
  host.publish("spine.scope.commit", { commitId: "commit-1" });

  assert.equal(observed.sequence, 1);
  assert.deepEqual(observed.payload, { commitId: "commit-1" });
  assert.throws(() => {
    observed.payload.commitId = "changed";
  }, TypeError);
});

test("rolls back plugin resources when activation fails", async () => {
  const host = new SpinePluginHost();
  host.register({
    manifest: {
      schema: "spine-host/v1",
      id: "failing",
      version: "0.1.0",
      toolNamespace: "failing",
      commandNamespace: "failing",
      storageNamespace: "failing",
    },
    activate(context) {
      context.tools.register("partial", {
        description: "Partial tool",
        execute: async () => null,
      });
      context.commands.register("partial", {
        description: "Partial command",
        execute: async () => null,
      });
      context.events.observe("partial.event", () => {});
      throw new Error("activation failed");
    },
  });

  await assert.rejects(host.activateAll(), /activation failed/);
  assert.deepEqual(host.listTools(), []);
  assert.deepEqual(host.listCommands(), []);
  host.publish("partial.event", { should: "not be observed" });
});

test("resets activation state after a missing dependency failure", async () => {
  const host = new SpinePluginHost();
  host.register({
    manifest: {
      schema: "spine-host/v1",
      id: "dependent",
      version: "0.1.0",
      requires: ["missing"],
    },
    activate() {},
  });

  await assert.rejects(host.activateAll(), /dependency missing is not registered/);
  host.register({
    manifest: {
      schema: "spine-host/v1",
      id: "missing",
      version: "0.1.0",
    },
    activate() {},
  });
  await host.activateAll();
});

test("routes a typed effect through its owner and post-commit sink", async () => {
  const sinkCalls = [];
  const host = new SpinePluginHost();
  host.register({
    manifest: canonicalManifest,
    activate(context) {
      context.effects.registerCommitter("spine.canonical", (effect) => ({
        receipt: {
          schema: "spine-tree-receipt/v1",
          receiptId: "receipt-1",
          operationId: effect.operationId,
          effectId: effect.effectId,
          targetOwner: effect.targetOwner,
          status: "committed",
          commitId: "commit-1",
          binding: { bindingId: effect.actor.bindingId, epoch: effect.actor.epoch },
        },
        record: { kind: "canonical-record", operationId: effect.operationId },
        projection: { visible: true },
      }));
      context.effects.registerPostCommitSink({
        id: "project-import",
        accepts: ["spine.canonical"],
        apply(record, deliveryId) {
          sinkCalls.push({ record, deliveryId });
        },
      });
    },
  });
  await host.activateAll();

  const receipt = await host.submitEffect({
    schema: "spine-tree-effect/v1",
    effectId: "effect-1",
    operationId: "operation-1",
    effectType: "spine.scope.commit",
    targetOwner: "spine.canonical",
    actor: { kind: "agent", agentId: "agent-1", bindingId: "binding-1", epoch: 4 },
    payload: { action: "close" },
  });

  assert.equal(receipt.receiptId, "receipt-1");
  assert.deepEqual(sinkCalls.map(({ deliveryId }) => deliveryId), [
    "project-import:spine.canonical:operation-1",
  ]);
  assert.deepEqual(sinkCalls[0].record, {
    schema: "spine-tree-post-commit/v1",
    effectType: "spine.scope.commit",
    receipt,
    record: { kind: "canonical-record", operationId: "operation-1" },
    projection: { visible: true },
    binding: { bindingId: "binding-1", epoch: 4 },
  });
});

test("does not dispatch post-commit sinks for rejected owner results", async () => {
  let sinkCalls = 0;
  const host = new SpinePluginHost();
  host.register({
    manifest: canonicalManifest,
    activate(context) {
      context.effects.registerCommitter("spine.canonical", (effect) => ({
        receipt: {
          schema: "spine-tree-receipt/v1",
          receiptId: "receipt-rejected",
          operationId: effect.operationId,
          effectId: effect.effectId,
          targetOwner: effect.targetOwner,
          status: "rejected",
          error: { code: "invalid", retryable: false, message: "invalid" },
        },
      }));
      context.effects.registerPostCommitSink({
        id: "must-not-run",
        accepts: ["spine.canonical"],
        apply() {
          sinkCalls += 1;
        },
      });
    },
  });
  await host.activateAll();

  const receipt = await host.submitEffect({
    schema: "spine-tree-effect/v1",
    effectId: "effect-rejected",
    operationId: "operation-rejected",
    effectType: "spine.scope.commit",
    targetOwner: "spine.canonical",
    actor: { kind: "system", actorId: "test" },
    payload: {},
  });

  assert.equal(receipt.status, "rejected");
  assert.equal(sinkCalls, 0);
});

test("does not let a plugin register a committer it does not own", async () => {
  const host = new SpinePluginHost();
  host.register({
    manifest: {
      schema: "spine-host/v1",
      id: "ordinary",
      version: "0.1.0",
    },
    activate(context) {
      assert.throws(
        () => context.effects.registerCommitter("spine.canonical", () => {
          throw new Error("must not run");
        }),
        (error) => error instanceof SpinePluginHostError && error.code === "effect-owner",
      );
    },
  });
  await host.activateAll();
});

test("preserves the committed receipt when a post-commit sink fails", async () => {
  const host = new SpinePluginHost();
  host.register({
    manifest: canonicalManifest,
    activate(context) {
      context.effects.registerCommitter("spine.canonical", (effect) => ({
        receipt: {
          schema: "spine-tree-receipt/v1",
          receiptId: "receipt-2",
          operationId: effect.operationId,
          effectId: effect.effectId,
          targetOwner: effect.targetOwner,
          status: "committed",
        },
        record: { committed: true },
      }));
      context.effects.registerPostCommitSink({
        id: "failing-sink",
        accepts: ["spine.scope.commit"],
        apply() {
          throw new Error("target unavailable");
        },
      });
    },
  });
  await host.activateAll();

  await assert.rejects(
    host.submitEffect({
      schema: "spine-tree-effect/v1",
      effectId: "effect-2",
      operationId: "operation-2",
      effectType: "spine.scope.commit",
      targetOwner: "spine.canonical",
      actor: { kind: "system", actorId: "test" },
      payload: {},
    }),
    (error) =>
      error instanceof SpinePluginHostError &&
      error.code === "post-commit-sink-failed" &&
      error.receipt?.receiptId === "receipt-2",
  );
});

test("allows only the owning canonical plugin to publish an already committed record", async () => {
  const sinkCalls = [];
  let canonicalPublish;
  let projectPublish;
  const host = new SpinePluginHost();
  host.register({
    manifest: canonicalManifest,
    activate(context) {
      canonicalPublish = context.effects.publishCommitted;
      context.effects.registerPostCommitSink({
        id: "typed-import",
        accepts: ["spine.scope.commit"],
        apply(record, deliveryId) {
          sinkCalls.push({ record, deliveryId });
        },
      });
    },
  });
  host.register(projectPlugin({
    activate(context) {
      projectPublish = context.effects.publishCommitted;
    },
  }));

  await host.activateAll();
  const committed = {
    schema: "spine-tree-post-commit/v1",
    effectType: "spine.scope.commit",
    receipt: {
      schema: "spine-tree-receipt/v1",
      receiptId: "receipt-publish",
      operationId: "operation-publish",
      effectId: "effect-publish",
      targetOwner: "spine.canonical",
      status: "committed",
      binding: { bindingId: "binding-publish", epoch: 3 },
    },
    record: { source: "canonical" },
    projection: { cursor: [0, 1] },
    binding: { bindingId: "binding-publish", epoch: 3 },
  };
  await canonicalPublish(committed);
  await assert.rejects(
    projectPublish(committed),
    (error) => error instanceof SpinePluginHostError && error.code === "effect-owner",
  );
  assert.deepEqual(sinkCalls.map(({ deliveryId }) => deliveryId), [
    "typed-import:spine.canonical:operation-publish",
  ]);
  assert.equal(Object.isFrozen(sinkCalls[0].record), true);
});

test("publishing a committed record after dispose is rejected", async () => {
  let publish;
  const host = new SpinePluginHost();
  host.register({
    manifest: canonicalManifest,
    activate(context) {
      publish = context.effects.publishCommitted;
    },
  });
  await host.activateAll();
  await host.dispose();
  await assert.rejects(
    publish({
      schema: "spine-tree-post-commit/v1",
      effectType: "spine.scope.commit",
      receipt: {
        schema: "spine-tree-receipt/v1",
        receiptId: "receipt-after-dispose",
        operationId: "operation-after-dispose",
        effectId: "effect-after-dispose",
        targetOwner: "spine.canonical",
        status: "committed",
      },
      record: {},
    }),
    (error) => error instanceof SpinePluginHostError && error.code === "host-started",
  );
});
