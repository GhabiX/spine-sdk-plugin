from pathlib import Path
from datetime import datetime, timezone
import ast, hashlib, json, subprocess

task=Path(__file__).resolve().parents[1]
ev=task/'evidence/resources'
out=ev/'offline-02'
r=json.loads((out/'result.json').read_text())
assert r['passed'] and r['samplings']==25 and r['toolPairs']==24
assert len(r['invocations'])==6 and len({x['version'] for x in r['invocations']})==3
assert r['allAgentsEnded'] and r['rootV1']!=r['rootV2']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report=ev/'offline-report.md'
report.write_text("""# Resource publication and consumption: offline result

Passed using actual frozen Pi, SDK/WASM and Git store with a scripted provider; no network/model requests. Runtime is the private snapshot of SDK ac887e6.

25 samplings produced 24 paired tool results. The scenario published a checked root multiplier and a checking skill, inherited both in a child, then published a same-name local tool and skill. Root x2 returned 14; local x3 returned 21. After root changed to x4, the local override still returned 21; a new sibling inherited root x4 and returned 28. Six invocations consumed three exact descriptor versions. Declared skill associations include both inherited and local sources; this is not proof of a real Agent following the guidance.

A call with the displaced tool version was rejected before execution. A publication with an old revision returned applied:false and retained the root tool version. After a fresh read, root publication succeeded. The Agent registry ended after disposal.

The first attempt failed in the fixture's assertion: Pi 0.87.1 marks a normally returned tool result isError:false even when its JSON payload has isError:true. Publisher conflicts return structured applied:false, and resource-use records phase:failed. A thrown stale-version error instead produces Pi isError:true. The corrected fixture inspects these separate contracts; it does not convert a conflict into success. Frozen runtime was not changed. The original script and failure evidence remain.

Sources: [result](offline-02/result.json), [states](offline-02/snapshots.json), [offers and calls](offline-02/samples.json), [original failure](offline/failure.json), [fixture](../../resources/offline.mjs). This verifies mechanics, not autonomous adoption or practical usefulness; a real Agent experiment follows.
""")
paths=[Path(__file__).resolve(),task/'resources/offline.mjs',ev/'offline-before-result-contract.mjs',ev/'offline-command.log',ev/'offline-command-02.log',ev/'offline/failure.json',out/'result.json',out/'snapshots.json',out/'samples.json',Path(r['session']),report,ev/'preparation.json',ev/'runtime-manifest.json',task/'runtime-resources/poc/src/poc/spinetree-resources.mjs',task/'runtime-resources/poc/src/poc/spinetree-resource-publisher.mjs',task/'runtime-resources/sdk/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js']
paths += [Path(v['path']) for v in r['script'].values()]
for v in r['script'].values(): assert sha(Path(v['path']))==v['sha256']
subprocess.run(['node','--check',str(task/'resources/offline.mjs')],check=True)
subprocess.run(['git','diff','--check'],cwd=task.parents[1],check=True)
ast.parse(Path(__file__).read_text())
for p in [report,task/'resources/offline.mjs',Path(__file__).resolve()]:
 assert all(line.rstrip()==line for line in p.read_text().splitlines()),str(p)
prep=json.loads((ev/'preparation.json').read_text())
old={'sha256':sha(ev/'offline-before-result-contract.mjs')}
# Preparation references the runner and runtime, not this later offline fixture.
result={'passed':True,'createdAt':datetime.now(timezone.utc).isoformat(),'externalModelRequests':0,'samplings':25,'toolPairs':24,'versionsConsumed':3,'invocations':6,'expectedRejections':2,'piToolErrors':1,'structuredPublicationConflicts':1,'allAgentsEnded':True,'sourceRevision':{'path':str(task/'resources/offline.mjs'),'before':old['sha256'],'beforePath':str(ev/'offline-before-result-contract.mjs'),'after':sha(task/'resources/offline.mjs')},'references':[{'path':str(p),'sha256':sha(p)} for p in paths]}
(ev/'offline-validation.json').write_text(json.dumps(result,indent=2)+'\n')
with (task/'worklog.md').open('a') as f:f.write('\n05 resources offline passed: 25 samplings/24 tools, inherited and local skills/tools, six calls across three versions, two expected rejection contracts. First fixture flag assumption corrected with failure preserved; frozen runtime unchanged. Real Agent still pending.\n')
print(json.dumps({'passed':True,'references':len(paths),'report':str(report)}))
