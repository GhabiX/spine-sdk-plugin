# Resource publication and consumption: offline result

Passed using actual frozen Pi, SDK/WASM and Git store with a scripted provider; no network/model requests. Runtime is the private snapshot of SDK ac887e6.

25 samplings produced 24 paired tool results. The scenario published a checked root multiplier and a checking skill, inherited both in a child, then published a same-name local tool and skill. Root x2 returned 14; local x3 returned 21. After root changed to x4, the local override still returned 21; a new sibling inherited root x4 and returned 28. Six invocations consumed three exact descriptor versions. Declared skill associations include both inherited and local sources; this is not proof of a real Agent following the guidance.

A call with the displaced tool version was rejected before execution. A publication with an old revision returned applied:false and retained the root tool version. After a fresh read, root publication succeeded. The Agent registry ended after disposal.

The first attempt failed in the fixture's assertion: Pi 0.87.1 marks a normally returned tool result isError:false even when its JSON payload has isError:true. Publisher conflicts return structured applied:false, and resource-use records phase:failed. A thrown stale-version error instead produces Pi isError:true. The corrected fixture inspects these separate contracts; it does not convert a conflict into success. Frozen runtime was not changed. The original script and failure evidence remain.

Sources: [result](offline-02/result.json), [states](offline-02/snapshots.json), [offers and calls](offline-02/samples.json), [original failure](offline/failure.json), [fixture](../../resources/offline.mjs). This verifies mechanics, not autonomous adoption or practical usefulness; a real Agent experiment follows.
