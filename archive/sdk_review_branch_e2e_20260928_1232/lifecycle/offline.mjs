import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const task=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sdk=join(task,'runtime/sdk'); process.env.SPINE_PLUGIN_WORKSPACE=sdk;
const {samplingFixture}=await import(pathToFileURL(join(task,'lifecycle/sampling-fixture.mjs')));
const {GitSpineTreeStore}=await import(pathToFileURL(join(sdk,'packages/spinetree-plugin/dist/index.js')));
const dir=join(task,'evidence/lifecycle/offline-04'); await mkdir(dir);
const root=join(dir,'tree');
const store=GitSpineTreeStore.initialize(root,{schema:'spinetree.snapshot/v2',branches:{root:{id:'root',parent:null,goal:'lifecycle fixture',status:'live',constraints:[],skills:[],tools:[],memory:null,memoryVersion:0,memorySource:null}}});
const f=await samplingFixture({directory:dir,options:{spinetree:{mode:'attach',root,agent:{agentId:'lifecycle',branch:'root'}}}});
const snapshots=[];
try {
 await f.start();
 const initial=store.readSnapshot(store.head()); const owner=initial.registry.lifecycle;
 const ops=[['spine_open',{goal:'reconcile records'}],['spine_open',{goal:'read contract'}],['spine_next',{goal:'compute totals',memory:'Integer cents; refunded rows excluded.'}],['spine_close',{memory:'Verified total 5900 cents.'}],['spine_open',{goal:'independent checks'}],['spine_close',{memory:'Six checks passed.'}],['spine_close',{memory:'Reconciled records with verified totals and six checks.'}]];
 for(const [name,input] of ops){await f.turn([{name,input}]); snapshots.push({name,head:store.head(),state:store.readSnapshot(store.head())});}
 const s=snapshots.at(-1).state; const bs=Object.values(s.branches); const work=bs.find(b=>b.goal==='reconcile records');
 assert.equal(bs.length,5); assert.equal(work.parent,'root'); assert.equal(work.status,'capped');
 for(const b of bs.filter(b=>b.id!=='root')){assert.equal(b.memoryVersion,1);assert.ok(b.memorySource);assert.ok(b.scopeBinding);}
 for(const b of bs.filter(b=>!['root',work.id].includes(b.id)))assert.equal(b.parent,work.id);
 const first=snapshots[1].state; const child=Object.values(first.branches).find(b=>b.goal==='read contract');
 assert.equal(s.branches[child.id].goal,'read contract'); assert.equal(s.branches[child.id].parent,work.id);
 assert.equal(s.registry.lifecycle.branch,'root'); assert.deepEqual(s.registry.lifecycle.scopeCursor,owner.scopeCursor);
 for(const key of ['sessionId','bindingId','leaseId','branch'])assert.equal(s.registry.lifecycle[key],owner[key]);
 await writeFile(join(dir,'initial.json'),JSON.stringify(initial,null,2)+'\n');
 await writeFile(join(dir,'before-reload.json'),JSON.stringify(s,null,2)+'\n');
 const h=store.head();await f.reload();assert.equal(store.head(),h);assert.deepEqual(store.readSnapshot(h),s);
 await writeFile(join(dir,'initial.json'),JSON.stringify(initial,null,2)+'\n');
 await f.shutdown();assert.equal(store.readSnapshot(store.head()).registry.lifecycle.status,'ended');
 await writeFile(join(dir,'snapshots.json'),JSON.stringify(snapshots,null,2)+'\n');
 await writeFile(join(dir,'result.json'),JSON.stringify({passed:true,operations:ops.map(([name])=>name),branches:bs.length,nested:true,reloadWriteFree:true,session:f.session.getSessionFile(),finalHead:store.head()},null,2)+'\n');
 console.log(JSON.stringify({passed:true,branches:bs.length,operations:ops.length,reloadWriteFree:true}));
}catch(e){await writeFile(join(dir,'failure.txt'),e.stack);try{await f.shutdown();}catch{}throw e;}
