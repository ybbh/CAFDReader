// 通用 CAF worker：容器校验、payload 读取、WASM 调用均不在页面主线程执行。
import {openCaf} from './caf.js';
import {Mailbox} from '../ai/protocol.js';
let mailbox;
let artifact, component;
let queue=Promise.resolve();
self.onmessage=({data})=>{
  if(data.op==='llmResult'){mailbox?.complete(data.id,data.value);return;}
  queue=queue.then(async()=>{
    const {id,op}=data;
    try {
      let value,transfer=[];
      if(op==='open') {
        artifact=await openCaf(data.source);
        if(data.requiredCapability&&(!Array.isArray(artifact.capabilities)||!artifact.capabilities.includes(data.requiredCapability)))throw new Error(`此 CAF 容器不是本阅读器支持的 CAFD 文档（缺少 ${data.requiredCapability}）`);
        const name=data.component || artifact.components[0]?.ref?.name || 'cafd';
        mailbox=new Mailbox(request=>self.postMessage({op:'llm',root:artifact.rootHash,component:name,...request}));
        mailbox.announce(data.llmBackends||[]);
        component=await artifact.instantiate(name,value=>mailbox.exchange(value));
        value={name:artifact.name,version:artifact.version,rootHash:artifact.rootHash,capabilities:artifact.capabilities,llm:artifact.manifest.policy.llm||null,files:Object.fromEntries(artifact.payloadFiles().map(p=>[p,artifact.fileLength(p)]))};
      } else if(!artifact) throw new Error('CAF 未打开');
      else if(op==='callPacked') value=await component.callPacked(data.name,...data.args);
      else if(op==='call') value=await component.call(data.name,...data.args);
      else if(op==='readPayload') {value=(await artifact.readPayload(data.path)).slice().buffer;transfer=[value];}
      else if(op==='llmAnnounce'){mailbox.announce(data.backends);value=true;}
      else if(op==='stats') value=artifact.stats();
      else throw new Error('不支持的 CAF worker 操作');
      self.postMessage({id,ok:true,value},transfer);
    } catch(error) {self.postMessage({id,ok:false,error:error.message});}
  });
};
