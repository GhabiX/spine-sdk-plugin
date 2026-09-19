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
