import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {AIService,verifyReceipt,hash} from '../web/ai/service.js';
import {Mailbox,admit,command} from '../web/ai/protocol.js';
const root='a'.repeat(64),other='b'.repeat(64),request={op:'submit',model_hint:'auto',prompt:'引用这段测试文字',max_tokens:64,temperature:0};
const config={url:'http://localhost:11434',model:'test',key:'SECRET-test'};
const store=new Map(),storage={get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
let allow='once',prompts=0,fetches=0;
const service=new AIService({storage,consent:async()=>{prompts++;return allow;},transport:async(url,options)=>{fetches++;assert.equal(url,'http://localhost:11434/api/chat');assert.equal(options.headers.Authorization,'Bearer SECRET-test');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).model,'test');return Response.json({message:{content:'答案 SECRET-test http://localhost:11434'},prompt_eval_count:12,eval_count:4});}});
const invoke=(s,id,extra={})=>s.generate({root,component:'cafd',id,request,...extra});
assert.deepEqual(await invoke(service,1),{status:'unavailable'});
service.configure('local',config);
const result=await invoke(service,1);assert.equal(result.status,'completed');assert.equal(prompts,1);assert.equal(fetches,1);assert.ok(await verifyReceipt(result.receipt));assert.equal(result.receipt.response_hash,await hash(result.text));assert.equal(result.receipt.usage.input,12);
for(const secret of ['SECRET-test','http://localhost:11434']){assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(service.announcements()).includes(secret));assert.ok(!JSON.stringify(service.exportUsage()).includes(secret));}
assert.equal(result.receipt.model_digest,null);
assert.equal(await verifyReceipt({...result.receipt,model:'forged'}),false);
await invoke(service,2);assert.equal(prompts,1);
service.close(root);allow='deny';assert.equal((await invoke(service,3)).status,'denied');assert.equal(fetches,2);
allow='allow';await invoke(service,4);service.close(root);await invoke(service,5);assert.equal(prompts,3);
assert.equal((await invoke(service,6,{root:other})).status,'completed');assert.equal(prompts,4,'Other artifact must request its own consent');
service.revoke();allow='deny';assert.equal((await invoke(service,7)).status,'denied');assert.equal(store.size,0);
assert.throws(()=>service.configure('cloud',{url:'https://a/?key=x',model:'m'}));
assert.throws(()=>service.configure('cloud',{url:'https://a/v1',model:''}));
service.configure('cloud',{disabled:true});assert.equal(service.announcements().length,1);
assert.equal((await invoke(service,8,{request:{...request,url:'http://evil'}})).status,'invalid');
service.clearUsage();assert.equal(service.records.length,0);
let cloudBody;const cloud=new AIService({consent:async()=> 'once',transport:async(url,options)=>{assert.equal(url,'https://example.invalid/v1/chat/completions');cloudBody=JSON.parse(options.body);return Response.json({model:'cloud-model-actual',choices:[{message:{content:'回答'}}]});}});
cloud.configure('cloud',{url:'https://example.invalid/v1/',model:'cloud-model'});
const c=await invoke(cloud,1);assert.equal(c.status,'completed');assert.equal(c.receipt.usage.input,null);assert.equal(c.receipt.model,'cloud-model-actual');assert.equal(c.receipt.model_source,'provider-response');assert.equal(cloudBody.model,'cloud-model');assert.ok(await verifyReceipt(c.receipt));
let dispatches=0;const mail=new Mailbox(()=>dispatches++);
assert.equal(mail.exchange(request).status,'unavailable');mail.announce([{tier:'local',model:'test',digest:null}]);
assert.equal(mail.exchange(request).id,1);assert.equal(mail.exchange(request).id,2);assert.equal(mail.exchange(request).status,'limit');assert.equal(dispatches,2);
assert.equal(mail.exchange({op:'cancel',id:1}).status,'cancelled');mail.complete(1,{status:'completed'});assert.equal(mail.exchange({op:'poll',id:1}).status,'cancelled');assert.equal(mail.exchange({op:'poll',id:999}).status,'unknown');
for(const bad of [{op:'discover',key:'x'},{...request,temperature:NaN},{...request,max_tokens:0},{...request,prompt:'汉'.repeat(6000)},{...request,model_hint:'http://evil'}])assert.throws(()=>command(bad));
const policy={self_read:true,network:false,filesystem:false,clock:false,random:false};
admit({policy,execution:{profile:'caf-d1',deterministic:true}});
admit({policy:{...policy,llm:'caf:llm@1'},execution:{profile:'caf-x1',deterministic:false}});
for(const manifest of [{policy:{...policy,llm:'caf:llm@1'},execution:{profile:'caf-d1',deterministic:true}},{policy:{...policy,llm:'caf:llm@2'},execution:{profile:'caf-x1',deterministic:false}},{policy:{...policy,network:true},execution:{profile:'caf-d1',deterministic:true}}])assert.throws(()=>admit(manifest));
const slow=new AIService({timeout:10,consent:async()=> 'once',transport:(_u,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('SECRET-test'))))});slow.configure('local',config);
const timed=await invoke(slow,1);assert.equal(timed.status,'error');assert.equal(timed.receipt.code,'timeout');assert.equal(timed.receipt.response_hash,null);assert.ok(await verifyReceipt(timed.receipt));
const cancel=new AIService({consent:async({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve('allow'))),transport:async()=>{throw Error('Must not send');}});cancel.configure('local',config);const pending=invoke(cancel,1);cancel.close(root);assert.equal((await pending).status,'cancelled');assert.equal(cancel.records.length,0);
console.log('PASS LLM policy, consent, bounded mailbox, cancellation, secrets, receipts, tamper rejection, local/cloud adapters and usage');

for(const vector of JSON.parse(await readFile(new URL('./llm-vectors.json',import.meta.url)))){
  const mailbox=new Mailbox(()=>{});mailbox.announce([{tier:'local',model:'test',digest:null}]);
  assert.equal(mailbox.exchange(vector.command).status,vector.status,JSON.stringify(vector.command));
}
console.log('PASS Shared Rust/Web LLM protocol vectors');

const deniedProvider=new AIService({consent:async()=> 'once',transport:async()=>new Response('SECRET-test provider diagnostic',{status:401})});
deniedProvider.configure('local',config);const rejected=await invoke(deniedProvider,1);assert.equal(rejected.receipt.code,'http_401');assert.ok(!JSON.stringify(rejected).includes('SECRET-test'));
console.log('PASS Actual provider model identity and sanitized HTTP authentication errors');

let listed=[];
const discovery=new AIService({transport:async(url,options)=>{assert.equal(url,'http://localhost:11434/api/tags');assert.equal(options.credentials,'omit');return Response.json({models:listed});}});
assert.deepEqual(await discovery.models('http://localhost:11434'),[]);
listed=[null,{}, {name:''},{name:'llama3.2:3b',digest:'a'.repeat(64)},{name:'llama3.2:3b',digest:'a'.repeat(64)},{name:'qwen-local',digest:'not-a-hash'}];
assert.deepEqual(await discovery.models('http://localhost:11434/'),[{name:'llama3.2:3b',digest:'a'.repeat(64)},{name:'qwen-local',digest:null}]);
const refusedDiscovery=new AIService({transport:async()=>new Response('',{status:403})});
await assert.rejects(()=>refusedDiscovery.models('http://localhost:11434'),/HTTP 403/);
const abortDiscovery=new AIService({transport:async(_url,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
const discoveryAbort=new AbortController(),listing=abortDiscovery.models('http://localhost:11434',{signal:discoveryAbort.signal});discoveryAbort.abort();
await assert.rejects(()=>listing,/模型检测已取消/);
console.log('PASS Model discovery: available/empty/malformed lists, duplicate removal, connection failure and cancellation');

// Browser fetch requires its global receiver. Arrow-function transport mocks
// conceal an Illegal invocation when a native fetch is called as a class field.
const originalFetch=globalThis.fetch;let browserFetchCalls=0;
try{
  globalThis.fetch=function(url){
    if(this!==globalThis)throw new TypeError('Illegal invocation');
    browserFetchCalls++;
    if(url.endsWith('/api/tags'))return Promise.resolve(Response.json({models:[{name:'qwen2.5:7b',digest:'a'.repeat(64)}]}));
    return Promise.resolve(Response.json({model:'qwen2.5:7b',message:{content:'连接成功'},prompt_eval_count:3,eval_count:2}));
  };
  const nativeFetchService=new AIService();
  const installed=await nativeFetchService.models('http://127.0.0.1:11434');
  assert.equal(installed[0].name,'qwen2.5:7b');
  nativeFetchService.configure('local',{url:'http://127.0.0.1:11434',model:installed[0].name});
  const generated=await invoke(nativeFetchService,1,{test:true});
  assert.equal(generated.status,'completed');assert.equal(generated.text,'连接成功');
  assert.ok(await verifyReceipt(generated.receipt));assert.equal(browserFetchCalls,2);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS Default browser fetch receiver for model discovery and generation');
