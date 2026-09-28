# Same-Branch memory reexecution: offline evidence

The actual frozen Pi session runtime, SDK/WASM and Git store completed the scripted no-network sequence. Parent Open/Close produced memory v1. Parent read/rejuvenate/send/dispatch caused a distinct reexecution Agent to observe/Open/Close; the same Branch UUID, parent and goal then retained memory v2. The old memory and its source are retained under reexecution.source. Parent refresh did not overwrite v2, duplicate enqueue did not write another Git commit, and both Agents ended.

There were 13 scripted samplings and 10 paired tool executions, no tool errors, two sessions and two Branches including root. This proves mechanism behavior, not real-Agent usability or candidate algorithm correctness. Regression tests for stale-owner cleanup were already covered by the committed integration suite; this run does not inject another lease race.

Two initial fixture failures are retained in offline/ and offline-02/. The fixture incorrectly inspected only the last projected user message and expected naked JSON. Actual projection has an evidence anchor before mailbox JSON and a following resource offer. The diagnostic captures public user messages only. Correcting fixture routing across those text lines produced offline-03 success; no frozen SDK/runtime modification was needed.
