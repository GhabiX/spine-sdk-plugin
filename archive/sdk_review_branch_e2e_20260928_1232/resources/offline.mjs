import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const task=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sdk=join(task,'runtime-resources/sdk');process.env.SPINE_PLUGIN_WORKSPACE=sdk;
const dir=resolve(process.argv[2]);await mkdir(dir,{recursive:false});
const load=p=>import(pathToFileURL(join(sdk,p)));
const core='node_modules/@earendil-works/pi-coding-agent/dist/core';
const [{ModelRuntime},{AuthStorage},{AssistantMessageEventStream},tree,{createSpineTreePiRuntimeFactory},{createRootCapabilityBasis},{resourceVersion}]=await Promise.all([
 load(`${core}/model-runtime.js`),load(`${core}/auth-storage.js`),
 load('node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js'),
 load('packages/spinetree-plugin/dist/index.js'),
 import(pathToFileURL(join(task,'runtime-resources/poc/src/poc/spinetree-pi-runtime.mjs'))),
 import(pathToFileURL(join(task,'runtime-resources/poc/src/poc/spinetree-root-capabilities.mjs'))),
 import(pathToFileURL(join(task,'runtime-resources/poc/src/poc/spinetree-resources.mjs'))),
]);
const root=join(dir,'tree'),agentDir=join(dir,'agent'),sessionDir=join(dir,'sessions');
await mkdir(agentDir);await mkdir(sessionDir);
const basis=createRootCapabilityBasis();basis.skills=basis.skills.filter(x=>['manage-obligation','discover-and-invoke','evolve-methods'].includes(x.name));
const store=tree.GitSpineTreeStore.initialize(root,{schema:'spinetree.snapshot/v2',branches:{root:{id:'root',parent:null,goal:'resource version checks',status:'live',constraints:[],...basis,memory:null,memoryVersion:0,memorySource:null}}});
const state=()=>store.readSnapshot(store.head()),snapshots=[];
const capture=label=>snapshots.push({label,head:store.head(),state:state()});
const script={};
for(const factor of [2,3,4]){
 const source=`const input=JSON.parse(process.argv[1]); console.log(JSON.stringify({value:input.value*${factor}}));\n`;
 const path=join(dir,`measure-${factor}.mjs`);await writeFile(path,source);
 const observed=JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',source,'--','{"value":7}'],{encoding:'utf8'}));
 assert.equal(observed.value,7*factor);
 script[factor]={path,sha256:createHash('sha256').update(source).digest('hex'),checked:observed};
}
const modelRuntime=await ModelRuntime.create({credentials:AuthStorage.inMemory(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
const samples=[],observed=[],calls=[];let step=0,localBranch,rootV1,oldRootRevision,localDescriptor;
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
const offerOf=context=>context.messages.filter(m=>m.role==='user').flatMap(m=>text(m).split('\n')).map(line=>{try{return JSON.parse(line);}catch{return null;}}).findLast(x=>x?.schema==='spinetree.resources.v1');
const lastResult=(ctx,error=false)=>{const m=ctx.messages.findLast(m=>m.role==='toolResult');assert.ok(m);assert.equal(m.isError===true,error,text(m));return error?text(m):JSON.parse(text(m));};
const call=(name,args)=>({name,args});
const use=(o,name,input)=>{const t=o.tools.find(t=>t.name===name);assert.ok(t);return call('spinetree_execute',{snapshot:o.snapshot,name,version:t.version,input,skills:o.skills.filter(s=>s.name==='audit-result').map(s=>({name:s.name,version:s.version}))});};
const read=branch=>call('spinetree_read',{branch});
const publish=(o,branch,revision,factor)=>use(o,'publish-resource',{branch,expectedRevision:revision,kind:'node-script',name:'measure',path:script[factor].path,expectedSha256:script[factor].sha256,contract:{input:'JSON {value:number}',output:`JSON {value:number}, input multiplied by ${factor}`,preconditions:['Node.js, self-contained script, finite numeric input']},evidence:[{check:'Executed entry bytes on value=7',result:`Observed value=${factor*7}`}]});
const skill=(o,branch,revision,local=false)=>use(o,'publish-resource',{branch,expectedRevision:revision,kind:'skill',name:'audit-result',contract:{input:'An offered measure call result',output:'Checked value and exact source/version',preconditions:[]},instruction:local?'For the local multiplier, assert value=21 when input=7; record local source and version.':'For input=7, check the value against the declared multiplier; record exact source and version.',evidence:[{check:'Prechecked script using value=7',result:local?'21':'14'}]});
const check=(ctx,value)=>{const r=lastResult(ctx);assert.equal(r.code,0);assert.equal(r.killed,false);assert.equal(JSON.parse(r.stdout).value,value);};
const plan=[
 (c,o)=>call('spine_open',{goal:'Publish checked shared resources'}),
 (c,o)=>read('root'),
 (c,o)=>{oldRootRevision=lastResult(c).revision;return publish(o,'root',oldRootRevision,2);},
 (c,o)=>{assert.equal(lastResult(c).applied,true);rootV1=o.tools.find(t=>t.name==='measure').version;return use(o,'measure',{value:7});},
 (c,o)=>{check(c,14);return read('root');},
 (c,o)=>skill(o,'root',lastResult(c).revision),
 (c,o)=>{assert.equal(lastResult(c).applied,true);capture('root-v1');return call('spine_close',{memory:'Shared multiplier 2 and audit-result skill published; invocation on 7 returned 14.'});},
 (c,o)=>call('spine_open',{goal:'Verify inheritance and isolated local refinement'}),
 (c,o)=>{localBranch=o.branch;assert.notEqual(localBranch,'root');assert.equal(o.tools.find(t=>t.name==='measure').source,'root');return use(o,'measure',{value:7});},
 (c,o)=>{check(c,14);return read(localBranch);},
 (c,o)=>publish(o,localBranch,lastResult(c).revision,3),
 (c,o)=>{assert.equal(lastResult(c).applied,true);return call('spinetree_execute',{snapshot:o.snapshot,name:'measure',version:rootV1,input:{value:7}});},
 (c,o)=>{assert.match(lastResult(c,true),/not offered/);return use(o,'measure',{value:7});},
 (c,o)=>{check(c,21);return read(localBranch);},
 (c,o)=>skill(o,localBranch,lastResult(c).revision,true),
 (c,o)=>{assert.equal(lastResult(c).applied,true);assert.equal(o.skills.find(s=>s.name==='audit-result').source,localBranch);return use(o,'measure',{value:7});},
 (c,o)=>{check(c,21);capture('local-override');localDescriptor=structuredClone(state().branches[localBranch]);return publish(o,'root',oldRootRevision,4);},
 (c,o)=>{const r=lastResult(c);assert.equal(r.isError,true);assert.equal(r.applied,false);assert.equal(resourceVersion(state().branches.root.tools.find(t=>t.name==='measure')),rootV1);return read('root');},
 (c,o)=>publish(o,'root',lastResult(c).revision,4),
 (c,o)=>{assert.equal(lastResult(c).applied,true);assert.deepEqual(state().branches[localBranch].tools,localDescriptor.tools);assert.equal(o.tools.find(t=>t.name==='measure').source,localBranch);capture('root-v2-local-preserved');return use(o,'measure',{value:7});},
 (c,o)=>{check(c,21);return call('spine_close',{memory:'Inherited root tool returned 14. Local override returned 21, also after root updated to multiplier 4. Stale version and stale revision rejected. Skill source is local.'});},
 (c,o)=>call('spine_open',{goal:'Consume revised ancestor method in a later obligation'}),
 (c,o)=>{const t=o.tools.find(t=>t.name==='measure');assert.equal(t.source,'root');assert.notEqual(t.version,rootV1);assert.equal(o.skills.find(s=>s.name==='audit-result').source,'root');return use(o,'measure',{value:7});},
 (c,o)=>{check(c,28);capture('later-consumption-v2');return call('spine_close',{memory:'Later sibling inherited root multiplier 4 and root skill; exact version invocation on 7 returned 28.'});},
];
modelRuntime.registerProvider('resource-fixture',{api:'openai-completions',baseUrl:'https://fixture.invalid',apiKey:'fixture',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:100000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],
 streamSimple(model,context,options){
  const o=offerOf(context);assert.ok(o);const fn=plan[step++];const op=fn?.(context,o);samples.push({sequence:step,offer:o,operation:op??null});
  const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:op?[{type:'toolCall',id:`resource-${step}`,name:op.name,arguments:op.args}]:[{type:'text',text:'Scripted no-network resource checks complete.'}],stopReason:op?'toolUse':'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const stream=new AssistantMessageEventStream();void(async()=>{await options.onPayload?.({model:model.id,messages:context.messages},model);stream.push({type:'done',reason:message.stopReason,message});stream.end();})().catch(e=>{stream.push({type:'error',reason:'error',error:{...message,content:[],stopReason:'error',errorMessage:e.message}});stream.end();});return stream;
 }});
const factory=createSpineTreePiRuntimeFactory({root,cwd:dir,agentDir,sessionDir,modelRuntime,model:modelRuntime.getModel('resource-fixture','fixture'),thinkingLevel:'off',settings:{compaction:{enabled:false}},onSession(h){h.session.subscribe(e=>{if(e.type==='tool_execution_end')observed.push({name:e.toolName,isError:e.isError});});}});
let handle;
try{
 handle=await factory.createSession({id:randomUUID(),agent:{agentId:'resource-parent',branch:'root'},name:'resources-offline'});
 await handle.prompt({text:'Run the deterministic resource version scenario.'});
 assert.equal(step,plan.length+1);assert.equal(observed.filter(r=>r.isError).length,1);
 const entries=handle.sessionManager.getEntries(),uses=entries.filter(e=>e.customType==='spinetree.resource-use.v1').map(e=>e.data);
 assert.equal(uses.filter(u=>u.phase==='rejected').length,1);assert.equal(uses.filter(u=>u.phase==='failed').length,1);
 const invocations=uses.filter(u=>u.phase==='succeeded'&&u.name==='measure');assert.equal(invocations.length,6);
 assert.equal(new Set(invocations.map(u=>u.version)).size,3);assert.ok(invocations.some(u=>u.declaredSkills.some(s=>s.source===localBranch)));
 const session=handle.sessionManager.getSessionFile();await handle.dispose();handle=null;
 assert.ok(Object.values(state().registry).every(a=>a.status==='ended'));
 await writeFile(join(dir,'snapshots.json'),JSON.stringify(snapshots,null,2)+'\n');
 await writeFile(join(dir,'samples.json'),JSON.stringify(samples,null,2)+'\n');
 const result={passed:true,provider:'scripted-no-network',session,samplings:step,toolPairs:observed.length,localBranch,rootV1,rootV2:resourceVersion(state().branches.root.tools.find(t=>t.name==='measure')),expectedRejected:2,piToolErrors:1,publisherConflicts:1,invocations,uses,script,finalHead:store.head(),allAgentsEnded:true,skillAssociationNotAdherence:true};
 await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,samplings:step,toolPairs:observed.length,expectedRejected:2,versions:3}));
}catch(e){await writeFile(join(dir,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,step,samples,observed,state:state()},null,2)+'\n');throw e;}
finally{await handle?.dispose();}
