// caf:llm/v1: synchronous, bounded mailbox; all ambient effects stay in the host.
export const LLM_CAPABILITY='caf:llm@1';
export const REQUEST_MAX=32768,RESPONSE_MAX=131072;
const encode=new TextEncoder();
export function command(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||encode.encode(JSON.stringify(value)).length>REQUEST_MAX)throw Error('invalid');
  const fields={discover:['op'],submit:['op','model_hint','prompt','max_tokens','temperature'],poll:['op','id'],cancel:['op','id']}[value.op];
  if(!fields||Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k)))throw Error('invalid');
  if(value.op==='submit'&&(!['auto','local','cloud'].includes(value.model_hint)||typeof value.prompt!=='string'||!value.prompt.length||encode.encode(value.prompt).length>16384||!Number.isInteger(value.max_tokens)||value.max_tokens<1||value.max_tokens>1024||!Number.isFinite(value.temperature)||value.temperature<0||value.temperature>2))throw Error('invalid');
  if(['poll','cancel'].includes(value.op)&&(!Number.isInteger(value.id)||value.id<0||value.id>0xffffffff))throw Error('invalid');
  return value;
}
export function admit(manifest) {
  const policy=manifest.policy,exec=manifest.execution;
  if(!policy||!exec)throw Error('Missing execution policy');
  if(Object.keys(policy).some(k=>!['llm','self_read','network','filesystem','clock','random'].includes(k)))throw Error('Unknown policy');
  for(const key of ['self_read','network','filesystem','clock','random'])if(typeof policy[key]!=='boolean')throw Error('Invalid policy');
  for(const key of ['network','filesystem','clock','random'])if(policy[key])throw Error(`Unsupported capability: ${key}`);
  if(policy.llm!==undefined&&policy.llm!==null&&policy.llm!==LLM_CAPABILITY)throw Error('Unsupported LLM version');
  if(!((exec.profile==='caf-d1'&&exec.deterministic===true)||(exec.profile==='caf-x1'&&exec.deterministic===false)))throw Error('Unsupported execution profile');
  if(policy.llm&&exec.profile!=='caf-x1')throw Error('LLM requires caf-x1');
}
export class Mailbox {
  constructor(dispatch){this.dispatch=dispatch;this.backends=[];this.tasks=new Map();this.next=0;}
  announce(backends){this.backends=backends;}
  complete(id,result){if(this.tasks.get(id)?.status==='pending'&&['completed','denied','unavailable','error','cancelled','limit','invalid'].includes(result?.status)&&encode.encode(JSON.stringify(result)).length<=RESPONSE_MAX)this.tasks.set(id,result);}
  exchange(value){
    try{command(value);}catch{return {status:'invalid'};}
    const {op,id}=value;
    if(op==='discover')return {status:'ready',protocol:LLM_CAPABILITY,backends:this.backends};
    if(op==='submit'){
      if(!this.backends.some(b=>value.model_hint==='auto'||b.tier===value.model_hint))return {status:'unavailable'};
      if(this.next>=128||[...this.tasks.values()].filter(v=>v.status==='pending').length>=2)return {status:'limit'};
      const id=++this.next,result={status:'pending',id};this.tasks.set(id,result);this.dispatch({id,request:value});return result;
    }
    if(op==='cancel'&&this.tasks.get(id)?.status==='pending'){this.tasks.set(id,{status:'cancelled',id});this.dispatch({cancel:id});}
    return this.tasks.get(id)||{status:'unknown'};
  }
}
