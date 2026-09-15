import assert from "node:assert/strict";
import test from "node:test";

import {
  SPINE_SDK_SCHEMA,
  SpineProtocolError,
  SpineRuntimeClient,
  decodeResponse,
  encodeCommand,
  encodeInit,
} from "../dist/index.js";

test("runtime client sends a schema-tagged request", async () => {
  const client = new SpineRuntimeClient({
    dispatch(encoded) {
      assert.deepEqual(JSON.parse(encoded), {
        schema: SPINE_SDK_SCHEMA,
        request: { type: "preview" },
      });
      return JSON.stringify({
        schema: SPINE_SDK_SCHEMA,
        ok: true,
        result: { type: "execution_registered" },
      });
    },
  });
  assert.deepEqual(await client.execute({ type: "preview" }), {
    type: "execution_registered",
  });
});

test("codec rejects unknown schemas and unsafe integers", () => {
  assert.throws(
    () => decodeResponse('{"schema":"spine-sdk/v2","ok":true,"result":{"type":"preview"}}'),
    SpineProtocolError,
  );
  assert.throws(
    () => encodeCommand({ type: "observe_sources", characters: [{ type: "opaque", boundary: Number.MAX_SAFE_INTEGER + 1 }] }),
    /safe integer/,
  );
  assert.throws(
    () => encodeInit({ thread: "unsafe", epoch: Number.MAX_SAFE_INTEGER + 1 }),
    /safe integer/,
  );
});

test("runtime errors remain typed protocol errors", async () => {
  const client = new SpineRuntimeClient({
    dispatch() {
      return JSON.stringify({
        schema: SPINE_SDK_SCHEMA,
        ok: false,
        error: { code: "invalid_state", message: "faulted" },
      });
    },
  });
  await assert.rejects(() => client.execute({ type: "preview" }), {
    name: "SpineProtocolError",
    code: "invalid_state",
  });
});
