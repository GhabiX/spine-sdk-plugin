# SpineTree Release Gate

Status: gate record for the current plugin boundary. This is not a claim that
every SpineTree path is production-ready.

## Architecture

One state has one owner.

- `@spinejit/spine-plugin` owns canonical Spine scope transitions, sampling,
  projection, compaction, recovery, and Spawn.
- `@spinejit/spine-host` owns registration, dependency order, namespaces,
  private storage, lifecycle, and session requests. It is not a second runtime.
- `@spinetree/plugin` is an ordinary contributor. It owns only the `spinetree`
  tool, command, and storage namespaces, and only when its selected load units
  claim them.
- ProjectBranch, Agent, WorkingBinding, Pi session, mailbox receipt, and
  SpineScope stay distinct. They meet through typed bindings.

`createSpineTreePlugin()` does not create `.spinetree`, start Git, or dispatch
mail by itself. The caller passes a store, registry, mailbox, and session
adapter, and calls `dispatchSpineTreeMailbox` outside the sending tool.

## Contract

- No explicit adapters: tools keep their input schema and return
  `contract-only`. No workspace state is created.
- `load: []` claims no namespace and registers no tools. Omitting `load` keeps
  the ProjectTree and collaboration units.
- Collaboration requires ProjectTree. The Pi session adapter requires
  collaboration. Navigation is the separate `@spinejit/spinetree-navigation`
  extension and does not own the canonical runtime.
- `spinetree_send` validates addresses and enqueues. It does not wait for the
  recipient. The same `requestId` and message returns the existing receipt; a
  different message under that key fails.
- A delivery lease may record `bindingId`. `delivered`, `release`, `fail`, and
  `observed` reject a different binding. After prompt completion, dispatch
  re-reads the stored lease and current binding. A changed token raises
  `lease-conflict` and does not overwrite the newer delivery.
- Registry resolution failure acquires no lease. An unknown or ended recipient
  becomes `failed`.
- Declared `agentId` is checked against the registry. The host has no caller
  identity field, so this is not authentication.

## Migration

Existing callers that omit `load` keep the previous factory behavior. To select
units, pass `load` with dependency order:

```ts
createSpineTreePlugin({
  load: ["@spinetree/project", "@spinetree/collaboration"],
  store,
  registry,
  mailbox,
})
```

Receipts written before `bindingId` remain valid. Dispatch stays caller-owned.
Do not point the old Unix live-model harness at current Pi 0.87.1: that server
no longer exports the helpers it imports. The passed real-model path is the
in-process `AgentSessionRuntime` smoke.

## Test report

Package suite, recorded at `6794884`:

```bash
cd scaffold/spine-sdk-plugin && npm test
```

SDK 6, Host 18, canonical 147, SpineTree 68, navigation 18. **257 passed / 0
failed.**

Integration evidence is in `scaffold/project-tree-poc`, not in this package:

| Check | Commit | Result |
| --- | --- | --- |
| mailbox binding fence | `6731aed` | included in the 257 package tests |
| spawn reservation restart | `8b8d8b2` | reservation tests passed |
| vertical recovery path | `78f0219` | `spinetree vertical poc ok` |
| deterministic recovery matrix | `6d3f985` | `spinetree d12 matrix ok` |
| grok-4.7 collaboration | `f79c493` | `spinetree real-model collaboration ok` |

The grok run used `cachetree/grok-4.7` at `http://127.0.0.1:4000/v1`. Two
sessions called read, send, and observe. The reply was `17 * 19 = 323`. Both
receipts ended `observed`.

## What can be used

Usable when the caller opts in with explicit adapters and handles the typed
failures covered above:

- host owner conflict, namespace, dependency rollback, and dispose
- ProjectTree read and expected-HEAD change through one Git `.spinetree` store
- queued mailbox send, request idempotency, lease fencing, and observe
- explicit load selection

Experimental, because the proof lives in the poc and not in a deployed host:

- vertical Pi/Git/mailbox recovery smoke
- durable Spawn reservation and restart faulting
- Pi 0.87.1 context-edit poc
- one grok-4.7 in-process collaboration run

## Known limitations

- A source archive can become durable before its post-commit intent is
  appended. The accepted result is `reconciliation-required`, not a guessed
  import.
- Archive state and `.spinetree` are not one atomic commit. Exactly-once across
  those stores is not claimed.
- There is no cross-process lock beyond Git expected-HEAD CAS and the receipt
  lease token.
- There is no automatic mailbox worker.
- An uncommitted durable Spawn terminal still cannot be finalized through the
  current Pi restart API. That path fails closed.
- The old Unix live-model service is not a supported entrypoint on Pi 0.87.1.

## Rollback

1. Do not register `@spinetree/plugin`, or pass `load: []`. The host keeps its
   base behavior and no `spinetree` namespace is claimed.
2. Register the factory without store, registry, and mailbox adapters. Tools
   stay `contract-only` and no `.spinetree` directory is created.
3. Set scope import off (`scopes: false`) to skip canonical import.
4. Dispose the host registration to drop the live plugin. This does not delete
   an existing Git history. Leave that history in place and stop passing the
   store; deleting it is not the rollback path.
