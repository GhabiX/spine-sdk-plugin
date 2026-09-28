from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,subprocess
TASK=Path(__file__).resolve().parents[1]
SDK=TASK.parents[1]; POC=SDK.parent/'project-tree-poc'; FROZEN=TASK/'runtime'
assert not FROZEN.exists()
record=json.loads((TASK/'evidence/commit/result.json').read_text())
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=SDK,text=True).strip()==record['commit']
FROZEN.mkdir()
for package in (SDK/'packages').iterdir():
 if not package.is_dir(): continue
 target=FROZEN/'sdk/packages'/package.name; target.mkdir(parents=True)
 for name in ['dist','wasm','src','test','spine.toml','package.json','README.md']:
  source=package/name
  if source.is_dir(): shutil.copytree(source,target/name,symlinks=True)
  elif source.is_file(): shutil.copy2(source,target/name)
for name in ['package.json','package-lock.json','core-source.json']:
 shutil.copy2(SDK/name,FROZEN/'sdk'/name)
subprocess.run(['cp','-a','--reflink=auto',str(SDK/'node_modules'),str(FROZEN/'sdk/node_modules')],check=True)
shutil.copytree(POC/'src/poc',FROZEN/'poc/src/poc',symlinks=True)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
for p,h in record['compiledFiles'].items(): assert digest(FROZEN/'sdk'/p)==h,p
rows=[]
for p in sorted(FROZEN.rglob('*')):
 if p.is_symlink():
  assert p.resolve().is_relative_to(FROZEN),p
  rows.append({'path':str(p.relative_to(FROZEN)),'symlink':str(p.readlink())})
 elif p.is_file(): rows.append({'path':str(p.relative_to(FROZEN)),'sha256':digest(p),'bytes':p.stat().st_size})
manifest={'createdAt':datetime.now(timezone.utc).isoformat(),'sdkCommit':record['commit'],'files':rows,'compiledFilesMatched':len(record['compiledFiles']),'model':'cachetree/grok-4.7','thinking':'high','note':'Complete private runtime copy. Credentials remain read-only external Pi auth storage; no keys copied.'}
(TASK/'evidence/lifecycle/runtime-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'frozen':str(FROZEN),'files':len(rows),'compiledMatched':len(record['compiledFiles'])}))
