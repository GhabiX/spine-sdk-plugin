import assert from "node:assert/strict";
import test from "node:test";
import { SpineTreeDisplay } from "../dist/pi/tree-view.js";

function projection(summary = "first", memory = null) {
  return {
    nodes: [
      { id: [1], parent: null, children: [[1, 1]], kind: "RootEpoch", status: "Opened", summary: null, memory: null, start: 0, end: null },
      { id: [1, 1], parent: [1], children: [], kind: "Task", status: "Live", summary, memory, start: 1, end: null },
    ], cursor: [1, 1], visible_context: [], last_boundary: 1,
  };
}

function fixture() {
  let component;
  let registrations = 0;
  let redraws = 0;
  const notifications = [];
  const tui = { terminal: { rows: 20 }, requestRender() { redraws++; } };
  const theme = { fg: (_color, text) => text, bold: (text) => text };
  const ctx = {
    mode: "tui", sessionManager: { getSessionId: () => "session" },
    abort() { assert.fail("display aborted execution"); },
    ui: {
      notify(message) { notifications.push(message); },
      setWidget(key, factory) {
        assert.equal(key, "spine-tree");
        component?.dispose();
        registrations++;
        component = factory?.(tui, theme);
      },
    },
  };
  const display = new SpineTreeDisplay();
  const offer = (p = projection(), generation = 1) => {
    let connection;
    display.offer({ version: 1, sessionId: "session", accept(value) { connection = value; } }, generation, p);
    assert.ok(connection);
    return connection;
  };
  return { display, ctx, offer, notifications, tui,
    get component() { return component; },
    get registrations() { return registrations; },
    get redraws() { return redraws; },
  };
}

const view = (text) => ({ render: () => [text], invalidate() {} });

test("one stable widget retains live updates while a detached browse snapshot is displayed", () => {
  const f = fixture();
  f.display.publish(f.ctx, 1, projection());
  const widget = f.component;
  const connection = f.offer();
  connection.snapshot.nodes[1].summary = "mutated snapshot";
  assert.match(widget.render(80).join("\n"), /first/);
  const ended = [];
  const lease = connection.attach(view("browsing first"), reason => ended.push(reason));
  f.display.publish(f.ctx, 1, projection("latest"));
  assert.equal(f.registrations, 1);
  assert.equal(f.component, widget);
  assert.deepEqual(widget.render(80), ["browsing first"]);
  lease.release();
  lease.release();
  assert.deepEqual(ended, ["released"]);
  assert.match(widget.render(80).join("\n"), /latest/);
});

test("snapshot sees memory changes even when the default tree drawing signature is unchanged", () => {
  const f = fixture();
  f.display.publish(f.ctx, 1, projection());
  const memory = [{ Summary: { owner_node: [1, 1], source: { start: 1, end: 2 }, body: "updated memory" } }];
  f.display.publish(f.ctx, 1, projection("first", memory));
  assert.deepEqual(f.offer(projection("first", memory)).snapshot.nodes[1].memory, memory);
  assert.equal(f.registrations, 1);
});

test("leases are exclusive, stale connections cannot attach, stale release cannot clear a newer view", () => {
  const f = fixture();
  f.display.publish(f.ctx, 1, projection());
  const old = f.offer();
  const reasons = [];
  const lease = old.attach(view("old"), reason => reasons.push(reason));
  assert.throws(() => old.attach(view("conflict"), () => {}), /already/);
  f.display.reset();
  assert.deepEqual(reasons, ["invalidated"]);
  f.display.publish(f.ctx, 2, projection("new session"));
  const newer = f.offer(projection("new session"), 2).attach(view("new view"), () => {});
  lease.release();
  lease.redraw();
  assert.deepEqual(f.component.render(80), ["new view"]);
  assert.throws(() => old.attach(view("stale"), () => {}), /no longer/);
  newer.release();
});

test("render, invalidate and end callback failures remain in the display boundary", () => {
  for (const method of ["render", "invalidate"]) {
    const f = fixture();
    f.display.publish(f.ctx, 1, projection());
    const reasons = [];
    const bad = view("bad");
    bad[method] = () => { throw new Error(`${method} failed`); };
    f.offer().attach(bad, reason => { reasons.push(reason); throw new Error("end failed"); });
    assert.doesNotThrow(() => f.component[method](80));
    assert.deepEqual(reasons, ["render-error"]);
    assert.match(f.component.render(80).join("\n"), /first/);
    assert.equal(f.notifications.length, 2);
  }
});

test("contributions are bounded and Pi disposal invalidates once without recursive widget removal", () => {
  const f = fixture();
  f.display.publish(f.ctx, 1, projection());
  const reasons = [];
  f.offer().attach({ render: () => Array(100).fill("very wide content"), invalidate() {} }, reason => reasons.push(reason));
  const lines = f.component.render(8);
  assert.equal(lines.length, 14);
  assert.ok(lines.every(line => line.length <= 8));
  const registrations = f.registrations;
  f.component.dispose();
  f.component.dispose();
  f.display.reset();
  assert.equal(f.registrations, registrations);
  assert.deepEqual(reasons, ["invalidated"]);
});

test("wrong version/session is ignored; offer consumer and even notification failures are isolated", () => {
  const f = fixture();
  f.display.publish(f.ctx, 1, projection());
  for (const request of [null, {}, { version: 2, sessionId: "session" }, { version: 1, sessionId: "other" }]) {
    f.display.offer({ ...request, accept() { assert.fail("incorrect offer"); } }, 1, projection());
  }
  f.ctx.ui.notify = () => { throw new Error("notification failed"); };
  assert.doesNotThrow(() => f.display.offer({ version: 1, sessionId: "session", accept() { throw new Error("consumer failed"); } }, 1, projection()));
});
