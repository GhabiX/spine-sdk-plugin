import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const task=resolve(fileURLToPath(new URL('..',import.meta.url))),sdk=join(task,'runtime-collaboration-live/sdk');
process.env.SPINE_PLUGIN_WORKSPACE=sdk;
const dir=resolve(process.argv[2]);assert.ok(dir.includes('/project-tree-poc/temp/testbed/'));
const load=p=>import(pathToFileURL(join(task,'runtime-collaboration-live/poc/src/poc',p)));
const [{createLocalGrokModelConfig},{createSpineTreePiRuntimeFactory},{createRootCapabilityBasis},tree]=await Promise.all([load('pi-local-grok.mjs'),load('spinetree-pi-runtime.mjs'),load('spinetree-root-capabilities.mjs'),import(pathToFileURL(join(sdk,'packages/spinetree-plugin/dist/index.js')))]);
const stamp=()=>new Date().toISOString();
const out=async(name,value)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n');
const root=join(dir,'.spinetree'),agentDir=join(dir,'.pi-agent'),sessionDir=join(dir,'.pi-sessions');
await mkdir(agentDir);await mkdir(sessionDir);
await out('.pi-agent/settings.json',{defaultProjectTrust:'always',compaction:{enabled:false}});
process.env.PI_CODING_AGENT_DIR=agentDir;
process.env.PI_SKIP_VERSION_CHECK='1';process.env.PI_TELEMETRY='0';
const methods=createRootCapabilityBasis().skills.filter(x=>['manage-obligation','split-and-integrate','communicate-and-reexecute'].includes(x.name));
const store=tree.GitSpineTreeStore.initialize(root,{schema:'spinetree.snapshot/v2',branches:{root:{id:'root',parent:null,goal:'Integrate independently implemented ledger modules and validate collaborative feedback',status:'live',constraints:[],skills:methods,tools:[],memory:null,memoryVersion:0,memorySource:null}}});
const config=await createLocalGrokModelConfig();assert.equal(config.model.id,'grok-4.7');
const id=randomUUID(),agentId='collaboration-'+randomUUID();
const sessions=[]; const pendingWrites=[];
const filtered=h=>h.sessionManager.getEntries().filter(e=>e.type==='message'&&e.message.role==='assistant').map(e=>({id:e.id,stopReason:e.message.stopReason,error:e.message.errorMessage,usage:e.message.usage,content:e.message.content.filter(p=>p.type==='text'||p.type==='toolCall')}));
const policy=["Work only inside the current experiment directory. Do not inspect credentials or files outside it, change runtime/configuration, delete anything, or launch background processes. Use the exposed contracts and inherited guidance. This experiment permits Spawn and feedback through supported reexecution sessions. Respect each assignment's file ownership. Do not publish resources or reorganize the project tree. Parent integration needs its own checks; report tool and test failures accurately."];
const child={command:process.execPath,args:['--import',join(task,'collaboration/child-preload.mjs')],
 piCli:join(sdk,'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
 extension:join(task,'runtime-collaboration-live/poc/src/poc/spinetree-runtime-extension.mjs')};
process.env.SPINE_TREE_RUNTIME_OPTIONS=JSON.stringify({cwd:dir,agentDir,sessionDir,
 provider:config.model.provider,model:config.model.id,thinkingLevel:config.thinkingLevel,
 settings:{compaction:{enabled:false}},appendSystemPrompt:policy,
 extensionPaths:[join(task,'collaboration/child-provider.mjs')]});
const factory=createSpineTreePiRuntimeFactory({root,cwd:dir,agentDir,sessionDir,...config,child,
 settings:{compaction:{enabled:false}},
 onSession(h){
  const sessionId=h.sessionManager.getSessionId();
  sessions.push({sessionId,session:h.sessionManager.getSessionFile()});
  pendingWrites.push(out('sessions.json',sessions));
  h.session.subscribe(e=>{
   if(e.type==='tool_execution_start')event({type:e.type,sessionId,toolName:e.toolName,toolCallId:e.toolCallId});
   if(e.type==='tool_execution_end')event({type:e.type,sessionId,toolName:e.toolName,isError:e.isError});
   if(e.type==='agent_end'){pendingWrites.push(out('session-'+sessionId+'-answers.json',{at:stamp(),assistants:filtered(h)}));}
  });
 },
 appendSystemPrompt:policy,
});
let handle,turn=0,closed=false;
const event=e=>{const v={at:stamp(),...e};console.log(JSON.stringify(v));void appendFile(join(dir,'launch.log'),JSON.stringify(v)+'\n');};
async function finish(){if(closed)return;closed=true;await handle?.dispose();await Promise.all(pendingWrites);await out('final-state.json',store.readSnapshot(store.head()));event({type:'closed',head:store.head()});}
try{
 handle=await factory.createSession({id,agent:{agentId,branch:'root'},name:'collaboration-poc'});
 await out('ready.json',{at:stamp(),pid:process.pid,sessionId:id,agentId,model:config.model.id,provider:config.model.provider,thinking:config.thinkingLevel,session:handle.sessionManager.getSessionFile(),sdkCommit:JSON.parse(await readFile(join(task,'evidence/collaboration/runtime-manifest-live.json'),'utf8')).sdkCommit});
 const manifestPath=join(dir,'manifest.yaml');
 await writeFile(manifestPath,(await readFile(manifestPath,'utf8')).replace(/^status: prepared$/m,'status: running').replace(/^pid: null$/m,`pid: ${process.pid}`).replace(/^started_at: null$/m,`started_at: '${stamp()}'`));
 event({type:'ready',sessionId:id,agentId});
 const input=createInterface({input:process.stdin,terminal:false});
 for await(const line of input){
  if(!line.trim())continue;
  const cmd=JSON.parse(line);if(cmd.type==='stop'){input.close();break;}
  assert.equal(cmd.type,'prompt');assert.equal(typeof cmd.text,'string');assert.ok(cmd.text.trim());
  const number=++turn; const before=handle.sessionManager.getEntries().length;
  await out(`turn-${number}-input.json`,{at:stamp(),...cmd});event({type:'prompt_started',turn:number});
  try{await handle.prompt({text:cmd.text});
   const entries=handle.sessionManager.getEntries().slice(before);
   const assistants=entries.filter(e=>e.type==='message'&&e.message.role==='assistant').map(e=>({id:e.id,stopReason:e.message.stopReason,error:e.message.errorMessage,usage:e.message.usage,content:e.message.content.filter(p=>p.type==='text'||p.type==='toolCall')}));
   await out(`turn-${number}-answer.json`,{at:stamp(),assistants});await out(`turn-${number}-state.json`,store.readSnapshot(store.head()));
   event({type:'prompt_complete',turn:number,samplings:assistants.length,head:store.head(),text:assistants.at(-1)?.content.filter(p=>p.type==='text').map(p=>p.text).join('\n')});
  }catch(e){await out(`turn-${number}-error.json`,{at:stamp(),name:e.name,message:e.message,stack:e.stack});event({type:'prompt_error',turn:number,message:e.message});}
 }
}finally{await finish();}
