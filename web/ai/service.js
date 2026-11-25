import {command} from './protocol.js';
const encoder=new TextEncoder();
export const canonical=value=>JSON.stringify(sort(value));
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const unhex=value=>new Uint8Array(value.match(/../g).map(v=>parseInt(v,16)));
export const hash=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function verifyReceipt(receipt){
  try{const {signature,public_key,...body}=receipt;
    const key=await crypto.subtle.importKey('jwk',public_key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(signature),encoder.encode(canonical(body)));
  }catch{return false;}
}
function endpoint(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('端点须为不含认证信息、查询参数或片段的 HTTP(S) 地址');return url.href.replace(/\/$/,'');}
const token=n=>Number.isSafeInteger(n)&&n>=0?n:null;
async function jsonResponse(response){
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>262144)throw Error('响应过大');
  const reader=response.body.getReader();let n=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>262144)throw Error('响应过大');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(n);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}
  return JSON.parse(new TextDecoder().decode(out));
}
export class AIService {
  #configs={};#key;#controllers=new Map();#sessionGrants=new Set();#consent;#storage;#fetch;#revision=0;#timeout;#nextReceipt=0;
  constructor({consent,storage,transport=globalThis.fetch.bind(globalThis),timeout=10000,onRecord=()=>{}}={}){
    this.#consent=consent||(async()=> 'deny');this.#storage=storage;this.#fetch=transport;this.#timeout=timeout;this.onRecord=onRecord;this.records=[];
  }
  configure(tier,{url,key='',model='',disabled=false,digest=null}){
    if(!['local','cloud'].includes(tier))throw Error('未知后端');
    const config={disabled:!!disabled,url:disabled?'':endpoint(url),key:disabled?'':key,model:disabled?'':model.trim(),digest:null};
    if(!disabled&&(!config.model||config.model.length>256||key.length>4096||/[\r\n]/.test(key)))throw Error('启用后须填写有效模型名和密钥格式');
    // Only a digest observed during an actual model listing is accepted by the UI.
    if(typeof digest==='string'&&/^(sha256:)?[a-f0-9]{64}$/.test(digest))config.digest=digest;
    this.cancelAll();this.#revision++;this.#configs[tier]=config;
  }
  announcements(){return Object.entries(this.#configs).filter(([,c])=>!c.disabled).map(([tier,c])=>({tier,model:c.model,digest:c.digest}));}
  async models(url,{signal}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
    const abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    try{const data=await jsonResponse(await this.#fetch(endpoint(url)+'/api/tags',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'}));
      if(!Array.isArray(data.models))throw Error('模型列表格式无效');
      return [...new Map(data.models.slice(0,256).filter(m=>m&&typeof m.name==='string'&&m.name.trim().length>0&&m.name.length<=256).map(m=>[m.name,{name:m.name,digest:typeof m.digest==='string'&&/^(sha256:)?[a-f0-9]{64}$/.test(m.digest)?m.digest:null}])).values()];
    }catch(error){
      if(signal?.aborted)throw Error('模型检测已取消');
      if(controller.signal.aborted)throw Error(`读取模型超时（${this.#timeout/1000} 秒）：确认 Ollama 服务和端点可访问`);
      if(error.message==='HTTP 403')throw Error('无法读取模型：服务返回 HTTP 403，请检查 Ollama 的 OLLAMA_ORIGINS 是否允许当前 Reader 地址');
      if(/^HTTP [1-5][0-9]{2}$/.test(error.message))throw Error(`无法读取模型：模型接口返回 ${error.message}，请检查端点和服务配置`);
      if(error.message==='模型列表格式无效'||error instanceof SyntaxError)throw Error('无法读取模型：端点未返回有效的 Ollama 模型列表，请填写 Ollama 服务根地址');
      throw Error('无法读取模型：浏览器未能完成连接，暂不能区分服务未启动与跨域限制。请在本机终端检查 /api/tags，并确认浏览器允许本地网络访问');
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  #grantKey(root,component,tier){return `caf-ai:grant:${root}:${component}:${tier}`;}
  async #authorize(root,component,tier,signal){
    const key=this.#grantKey(root,component,tier);
    try{if(this.#storage?.getItem(key)==='allow'||this.#sessionGrants.has(key))return true;}catch{}
    const decision=await this.#consent({root,component,tier,signal});
    if(signal.aborted)return false;
    if(decision==='allow'){try{this.#storage?.setItem(key,'allow');}catch{}this.#sessionGrants.add(key);return true;}
    if(decision==='once'){this.#sessionGrants.add(key);return true;}return false;
  }
  revoke(){this.cancelAll();this.#sessionGrants.clear();try{for(let i=this.#storage.length-1;i>=0;i--){const key=this.#storage.key(i);if(key?.startsWith('caf-ai:grant:'))this.#storage.removeItem(key);}}catch{}}
  cancel(root,id){this.#controllers.get(`${root}:${id}`)?.abort();}
  cancelAll(){for(const controller of this.#controllers.values())controller.abort();}
  close(root){for(const [key,c] of this.#controllers)if(key.startsWith(root+':'))c.abort();for(const key of this.#sessionGrants)if(key.startsWith(`caf-ai:grant:${root}:`))this.#sessionGrants.delete(key);}
  clearUsage(){this.records=[];}
  exportUsage(){return {schema:'caf:llm-usage@1',receipts:this.records};}
  async generate({root,component,id,request,test=false,context=null}){
    try{command(request);}catch{return {status:'invalid'};}
    if(request.op!=='submit'||!(/^[a-f0-9]{64}$/.test(root))||!(/^[a-zA-Z0-9_-]{1,64}$/.test(component)))return {status:'invalid'};
    const tier=request.model_hint==='auto'?(this.#configs.local&&!this.#configs.local.disabled?'local':'cloud'):request.model_hint;
    const config=this.#configs[tier];if(!config||config.disabled)return {status:'unavailable'};
    const callKey=`${root}:${id}`;
    if(this.#controllers.has(callKey)||this.#controllers.size>=2||this.records.length>=128)return {status:'limit'};
    if(!crypto.subtle)return {status:'error',code:'secure_context_required'};
    const controller=new AbortController(),revision=this.#revision;this.#controllers.set(callKey,controller);
    let sent=false,timer,started,text='',reportedModel=null,usage={input:null,output:null},status='error',code=null;
    const parameters={max_tokens:request.max_tokens,temperature:request.temperature};
    const body=tier==='local'?{model:config.model,messages:[{role:'user',content:request.prompt}],stream:false,options:{num_predict:parameters.max_tokens,temperature:parameters.temperature}}:{model:config.model,messages:[{role:'user',content:request.prompt}],stream:false,...parameters};
    try{
      if(!test&&!await this.#authorize(root,component,tier,controller.signal))return {status:controller.signal.aborted?'cancelled':'denied'};
      if(controller.signal.aborted||revision!==this.#revision)return {status:'cancelled'};
      this.#key??=crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
      await this.#key;
      if(controller.signal.aborted)return {status:'cancelled'};
      started=Date.now();timer=setTimeout(()=>{code='timeout';controller.abort();},this.#timeout);sent=true;
      const data=await jsonResponse(await this.#fetch(config.url+(tier==='local'?'/api/chat':'/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json',...(config.key?{Authorization:`Bearer ${config.key}`}:{})},body:JSON.stringify(body),signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'}));
      text=tier==='local'?data.message?.content:data.choices?.[0]?.message?.content;
      if(typeof text!=='string'||encoder.encode(text).length>32768)throw Error('invalid_response');
      for(const secret of [config.key,config.url])if(secret)text=text.replaceAll(secret,'[已隐藏]');
      if(typeof data.model==='string'&&data.model.length>0&&data.model.length<=256&&![config.key,config.url].filter(Boolean).some(secret=>data.model.includes(secret)))reportedModel=data.model;
      usage=tier==='local'?{input:token(data.prompt_eval_count),output:token(data.eval_count)}:{input:token(data.usage?.prompt_tokens),output:token(data.usage?.completion_tokens)};
      status=controller.signal.aborted?'cancelled':'completed';
    }catch(error){status=controller.signal.aborted?(code==='timeout'?'error':'cancelled'):'error';code??=/^HTTP [1-5][0-9]{2}$/.test(error.message)?'http_'+error.message.slice(5):error.message==='invalid_response'?'invalid_response':'backend_error';}
    finally{clearTimeout(timer);this.#controllers.delete(callKey);}
    if(!sent)return {status,code};
    if(status!=='completed')text='';
    const receipt={protocol:'caf:llm-receipt@1',root_hash:root,component,call_id:++this.#nextReceipt,task_id:id,backend:tier,model:reportedModel||config.model,configured_model:config.model,model_source:reportedModel?'provider-response':'configuration',model_digest:(!reportedModel||reportedModel===config.model)?config.digest:null,model_digest_source:config.digest&&(!reportedModel||reportedModel===config.model)?'listing-at-configuration':null,parameters,request_hash:await hash(canonical(body)),response_hash:status==='completed'?await hash(text):null,timestamp:new Date(started).toISOString(),latency_ms:Date.now()-started,status,code,usage,signature_algorithm:'ECDSA-P256-SHA256',trust:'session-self-signed'};
    const keys=await this.#key;
    const signature=hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,encoder.encode(canonical(receipt))));
    const signed={...receipt,public_key:await crypto.subtle.exportKey('jwk',keys.publicKey),signature};
    this.records.push(signed);this.onRecord({receipt:signed,text,test,context});
    return {status,text,receipt:signed};
  }
}
