import assert from "node:assert/strict";
import test from "node:test";
import { SpinePluginHost } from "../dist/index.js";

test("exposes descriptions and isolated schema metadata without execution access", async () => {
  const host = new SpinePluginHost();
  const parameters = {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
  };
  let executions = 0;
  host.register({
    manifest: { schema: "spine-host/v1", id: "metadata", version: "1", toolNamespace: "metadata" },
    activate(context) {
      context.tools.register("typed", {
        description: "Typed tool", parameters,
        execute(input) { executions++; return input; },
      });
      context.tools.register("untyped", { description: "Untyped tool", execute() {} });
    },
  });
  await host.activateAll();
  const descriptor = host.describeTool("metadata_typed");
  assert.deepEqual(descriptor, { description: "Typed tool", parameters });
  assert.deepEqual(host.describeTool("metadata_untyped"), { description: "Untyped tool" });
  descriptor.parameters.properties.target.type = "number";
  descriptor.parameters.required.push("extra");
  assert.deepEqual(host.describeTool("metadata_typed").parameters, parameters);
  assert.equal(executions, 0);
  // Host transports metadata; it does not introduce another validation layer.
  assert.equal(await host.executeTool("metadata_typed", "caller input"), "caller input");
  assert.equal(executions, 1);
  assert.throws(() => host.describeTool("missing"), { code: "unknown-tool" });
  await host.dispose();
  assert.throws(() => host.describeTool("metadata_typed"), { code: "unknown-tool" });
});
