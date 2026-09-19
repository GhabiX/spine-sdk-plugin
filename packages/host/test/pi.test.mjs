import assert from "node:assert/strict";
import test from "node:test";
import { createPiSessionAdapter } from "@spinejit/spine-host/pi";

function serverError(code) {
  return Object.assign(new Error(code), { name: "PiServerError", code });
}

test("routes concurrent requests to caller-owned leases and waits for each command", async () => {
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  const calls = [];
  const leases = new Map([
    ["a", {
      id: "a", active: true,
      async prompt(...args) {
        calls.push([this.id, "prompt", args]);
        started.resolve();
        return pending.promise;
      },
      async dispose() { assert.fail("adapter must not dispose a caller-owned lease"); },
    }],
    ["b", {
      id: "b", active: true,
      async steer(...args) { calls.push([this.id, "steer", args]); },
    }],
  ]);
  const adapter = createPiSessionAdapter(async id => leases.get(id));
  let settled = false;
  const first = adapter.request({ targetSessionId: "a", operation: "prompt", text: "one", requestId: "mail-1" })
    .then(result => { settled = true; return result; });
  await started.promise;
  assert.deepEqual(await adapter.request({ targetSessionId: "b", operation: "steer", text: "two" }), { accepted: true });
  assert.equal(settled, false);
  pending.resolve({ id: "a", revision: 1 });
  assert.deepEqual(await first, { accepted: true, requestId: "mail-1" });
  assert.deepEqual(calls, [["a", "prompt", ["one"]], ["b", "steer", ["two"]]]);
});

test("declines missing or inactive leases and rejects wrong-session routing", async () => {
  const request = { targetSessionId: "a", operation: "prompt", text: "one", requestId: "mail-1" };
  const inactive = { id: "a", active: false, prompt() { assert.fail("inactive lease invoked"); } };
  for (const lease of [undefined, inactive]) {
    assert.deepEqual(await createPiSessionAdapter(() => lease).request(request), {
      accepted: false, requestId: "mail-1",
    });
  }
  await assert.rejects(
    createPiSessionAdapter(() => ({ ...inactive, id: "b", active: true })).request(request),
    { code: "session-lease-mismatch" },
  );
});

test("maps Pi busy/locked to rejection and preserves other error objects", async () => {
  const request = { targetSessionId: "a", operation: "prompt", text: "one", requestId: "mail-1" };
  let failure;
  const adapter = createPiSessionAdapter(() => ({
    id: "a", active: true, async prompt() { throw failure; },
  }));
  for (const code of ["busy", "session_locked"]) {
    failure = serverError(code);
    assert.deepEqual(await adapter.request(request), { accepted: false, requestId: "mail-1" });
  }
  for (const error of [
    serverError("not_found"), serverError("internal_error"), serverError("invalid_request"),
    new Error("disconnected"), Object.assign(new Error("unrelated"), { code: "busy" }),
  ]) {
    failure = error;
    await assert.rejects(adapter.request(request), actual => actual === error);
  }
  const error = new Error("resolver failed");
  await assert.rejects(createPiSessionAdapter(async () => { throw error; }).request(request), actual => actual === error);
});

test("rejects invalid operations and inputs before resolving any lease", async () => {
  const adapter = createPiSessionAdapter(() => assert.fail("invalid input reached resolver"));
  const valid = { targetSessionId: "a", operation: "prompt", text: "one" };
  for (const request of [
    null, {}, { ...valid, targetSessionId: "" }, { ...valid, operation: "dispose" },
    { ...valid, text: 1 }, { ...valid, requestId: "" },
  ]) {
    await assert.rejects(adapter.request(request), { code: "invalid-session-request" });
  }
});

test("echoes requestId locally without implementing remote deduplication or automatic retries", async () => {
  let calls = 0;
  const adapter = createPiSessionAdapter(() => ({
    id: "a", active: true,
    async prompt(...args) { calls++; assert.deepEqual(args, ["one"]); },
  }));
  const request = { targetSessionId: "a", operation: "prompt", text: "one", requestId: "mail-1" };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await adapter.request(request), { accepted: true, requestId: "mail-1" });
  }
  assert.equal(calls, 2);
});
