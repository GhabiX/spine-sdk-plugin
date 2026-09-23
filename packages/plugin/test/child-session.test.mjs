import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  buildChildAssignment,
  CHILD_RETURN_TOOL,
  buildChildContinuation,
  childSessionPath,
  inspectChildSession,
  readChildSessionIdentity,
  writeChildPrefixSession,
} from "../dist/pi/child-session.js";

test("child assignment names identity, peers, descendant tools, and typed return", () => {
  const text = buildChildAssignment(
    { summary: "ALPHA", prompt: "return TOKEN_A" },
    [
      { summary: "ALPHA", prompt: "return TOKEN_A" },
      { summary: "BETA", prompt: "return TOKEN_B" },
    ],
  );
  assert.match(text, /You are: ALPHA/);
  assert.match(text, /^- BETA$/m);
  assert.doesNotMatch(text, /^- ALPHA$/m);
  assert.match(text, /already an active branch scope/);
  assert.match(text, /spine_open/);
  assert.match(text, /spine_close/);
  assert.match(text, /spine_next/);
  assert.match(text, /spine_spawn/);
  assert.match(text, /independent parallel sub-assignments/);
  assert.match(text, new RegExp(`${CHILD_RETURN_TOOL} exactly once`));
  assert.match(text, /Assignment:\nreturn TOKEN_A$/);
});

test("written prefix session is a Pi-openable fork of the parent branch", async () => {
  const dest = join(await mkdtemp(join(tmpdir(), "pi-spine-prefix-")), "child.jsonl");
  const entries = [
    {
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: "2026-09-17T12:00:00.000Z",
      message: { role: "user", content: "parent prefix TOKEN", timestamp: 1 },
    },
  ];
  const id = await writeChildPrefixSession({
    cwd: "/tmp/project",
    destPath: dest,
    entries,
    parentSession: "/tmp/parent.jsonl",
  });
  assert.equal(await readChildSessionIdentity(dest), id);
  const raw = await readFile(dest, "utf8");
  assert.match(raw, /"parentSession":"\/tmp\/parent.jsonl"/);
  const session = SessionManager.open(dest, undefined, "/tmp/project");
  const branch = session.getBranch();
  assert.equal(branch.length, 1);
  assert.equal(branch[0].type, "message");
  assert.equal(branch[0].message.content, "parent prefix TOKEN");
});

test("child session path stays next to the parent session file when one exists", () => {
  assert.equal(
    childSessionPath({
      batchId: "spawn-1",
      ordinal: 0,
      parentSessionFile: "/tmp/sessions/parent.jsonl",
    }),
    "/tmp/sessions/spine-spawn/spawn-1/0.jsonl",
  );
  assert.match(
    childSessionPath({ batchId: "spawn/1", ordinal: 2 }),
    /pi-spine-spawn\/spawn_1\/2\.jsonl$/,
  );
  assert.match(
    childSessionPath({ batchId: "spawn-1", ordinal: 2, attempt: 1 }),
    /pi-spine-spawn\/spawn-1\/2\.attempt-1\.jsonl$/,
  );
});

test("child continuation preserves the active session and optional guidance", () => {
  const prompt = buildChildContinuation("focus on the failing test");
  assert.match(prompt, /same active branch/);
  assert.match(prompt, /focus on the failing test/);
  assert.match(prompt, /spine_child_return exactly once/);
});

test("child session inspection detects durable assignment context", async () => {
  const dest = join(await mkdtemp(join(tmpdir(), "pi-spine-inspect-")), "child.jsonl");
  const assignment = buildChildAssignment(
    { summary: "ALPHA", prompt: "return TOKEN_A" },
    [{ summary: "ALPHA", prompt: "return TOKEN_A" }],
  );
  const id = await writeChildPrefixSession({
    cwd: "/tmp/project",
    destPath: dest,
    entries: [],
  });
  const headerOnly = await inspectChildSession({
    cwd: "/tmp/project",
    destPath: dest,
    expectedId: id,
    assignment,
  });
  assert.equal(headerOnly.assignmentPresent, false);

  const session = SessionManager.open(dest, undefined, "/tmp/project");
  session.appendMessage({ role: "user", content: assignment, timestamp: Date.now() });
  const durable = await inspectChildSession({
    cwd: "/tmp/project",
    destPath: dest,
    expectedId: id,
    assignment,
  });
  assert.equal(durable.assignmentPresent, true);
  await assert.rejects(
    inspectChildSession({
      cwd: "/tmp/project",
      destPath: dest,
      expectedId: "wrong-session-id",
      assignment,
    }),
    /identity changed/,
  );
});

test("child session inspection rejects uncommitted nested Spawn staging", async () => {
  const dest = join(await mkdtemp(join(tmpdir(), "pi-spine-staged-")), "child.jsonl");
  const id = await writeChildPrefixSession({
    cwd: "/tmp/project",
    destPath: dest,
    entries: [],
  });
  const session = SessionManager.open(dest, undefined, "/tmp/project");
  session.appendCustomEntry("spine.spawn-terminal.v1", {
    schema: "spine-plugin/pi/v1",
    batchId: "nested-batch",
    result: { ordinal: 0, outcome: "completed", memory_body: "nested memory" },
  });

  await assert.rejects(
    inspectChildSession({
      cwd: "/tmp/project",
      destPath: dest,
      expectedId: id,
      assignment: "Assignment:\nreturn TOKEN_A",
    }),
    /uncommitted Spine Spawn staging/,
  );
});

test("child continuation includes assignment only for the missing-context fallback", () => {
  const assignment = "Assignment:\nreturn TOKEN_A";
  const normal = buildChildContinuation();
  const fallback = buildChildContinuation(undefined, assignment);
  assert.doesNotMatch(normal, /Assignment context:/);
  assert.match(fallback, /Assignment context:/);
  assert.match(fallback, /return TOKEN_A/);
});
