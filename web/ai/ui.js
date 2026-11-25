import {AIService} from './service.js';
function element(tag,text,attributes={}){const e=document.createElement(tag);if(text)e.textContent=text;for(const [k,v] of Object.entries(attributes))e.setAttribute(k,v);return e;}
function button(label,handler){const b=element('button',label,{type:'button'});b.onclick=handler;return b;}
export function createAIUI({onChange=()=>{},currentRoot=()=>null,currentContext=()=>null}={}){
  const dialog=element('dialog',null,{class:'ai-dialog','aria-labelledby':'ai-title'});
  dialog.append(element('h2','AI 模型',{id:'ai-title'}),element('p','配置仅在当前页面生效。请在打开演示或书籍的同一页完成配置；刷新、跳转或打开新标签页后需重新配置。'));
  const message=element('p','未配置',{role:'status',id:'ai-status'});
  let models=[];let testId=0;let refreshModels=()=>{};
  function label(text,input){const l=element('label',text);l.append(input);return l;}
  function input(id,type='text',value=''){const i=element('input',null,{id,type,autocomplete:'off'});i.value=value;return i;}
  async function run(fn){try{await fn();}catch(error){message.textContent=error.message;}}
  for(const [tier,title] of [['local','本地 Ollama'],['cloud','云端兼容 API']]){
    const group=element('fieldset');group.append(element('legend',title));
    const disabled=input(`ai-${tier}-disabled`,'checkbox');disabled.checked=tier==='cloud';
    const url=input(`ai-${tier}-url`,'url',tier==='local'?'http://localhost:11434':'');
    const model=tier==='local'?element('select',null,{id:'ai-local-model'}):input('ai-cloud-model');
    const key=input(`ai-${tier}-key`,'password');
    group.append(label('禁用',disabled),label('端点',url),label('模型',model));if(tier==='cloud')group.append(label('API Key（服务允许时可留空）',key));
    if(tier==='local'){
      const hint=element('p','打开设置后自动检测已安装模型。',{id:'ai-local-model-status',role:'status'});
      model.setAttribute('aria-describedby',hint.id);
      const detect=button('检测已安装模型',()=>refreshModels());
      let generation=0,controller,loadedEndpoint='';
      function placeholder(text){model.replaceChildren(new Option(text,''));model.disabled=true;}
      function invalidate(text){generation++;controller?.abort();controller=null;models=[];loadedEndpoint='';placeholder(text);model.removeAttribute('aria-busy');detect.disabled=disabled.checked;}
      placeholder('尚未检测模型');
      refreshModels=async()=>{
        if(disabled.checked){invalidate('本地模型已禁用');hint.textContent='取消禁用后可自动检测模型。';return;}
        const endpoint=url.value.trim(),previous=loadedEndpoint===endpoint?model.value:'';
        const ticket=++generation;controller?.abort();controller=new AbortController();
        models=[];placeholder('正在检测模型…');model.setAttribute('aria-busy','true');detect.disabled=true;
        hint.textContent='正在连接 Ollama，读取已安装模型…';
        try{
          const found=await service.models(endpoint,{signal:controller.signal});
          if(ticket!==generation)return;
          models=found;loadedEndpoint=endpoint;
          if(!models.length){placeholder('未发现已安装模型');hint.textContent='Ollama 已连接，但尚未安装模型。请展开“模型准备”手工下载或导入，再重新检测。';return;}
          model.replaceChildren(...models.map(m=>new Option(m.name,m.name)));model.disabled=false;
          model.value=models.some(m=>m.name===previous)?previous:['llama3.2:3b','qwen2.5:3b','qwen2.5:7b'].find(name=>models.some(m=>m.name===name))||models[0].name;
          hint.textContent=`已发现 ${models.length} 个模型。选择后点击“应用配置”或“连接测试 / 预热”。`;
        }catch(error){
          if(ticket!==generation)return;
          placeholder('模型读取失败，请重新检测');
          hint.textContent=error.message+'。确认 Ollama 已启动；手机访问时请填写电脑的局域网地址。';
        }finally{if(ticket===generation){controller=null;model.removeAttribute('aria-busy');detect.disabled=false;}}
      };
      url.oninput=()=>{invalidate('端点已更改，等待重新检测');hint.textContent='完成端点修改后将重新检测模型。';};
      url.onchange=()=>refreshModels();disabled.onchange=()=>refreshModels();
      dialog.addEventListener('close',()=>{generation++;controller?.abort();controller=null;model.removeAttribute('aria-busy');detect.disabled=disabled.checked;});
      group.append(hint,detect);
    }
    const configure=async()=>{service.configure(tier,{url:url.value,key:key.value,model:model.value,disabled:disabled.checked,digest:tier==='local'?models.find(m=>m.name===model.value)?.digest:null});await onChange(service.announcements());};
    group.append(button('应用配置',()=>run(async()=>{await configure();message.textContent=service.announcements().length?'配置已应用，点击连接测试确认可用':'未配置';})));
    group.append(button('连接测试 / 预热',()=>run(async()=>{await configure();message.textContent='正在测试…';const result=await service.generate({root:'0'.repeat(64),component:'connection-test',id:++testId,test:true,request:{op:'submit',model_hint:tier,prompt:'请回复：连接成功',max_tokens:16,temperature:0}});message.textContent=result.status==='completed'?`${result.receipt.model} · ${result.receipt.latency_ms} ms · 连接成功`:`不可用：${result.code||result.status}。检查模型、CORS、HTTPS 与本地网络权限。`;})));
    dialog.append(group);
  }
  const prepare=element('details');prepare.append(element('summary','模型准备：手工下载、导入和预热'));
  prepare.append(element('p','在 Ollama 所在电脑操作。手机的 localhost 指手机本身，请填写电脑局域网地址。Reader 不会自动下载或执行命令。'));
  const manual=input('ai-manual-model','text','llama3.2:3b'),commands=element('pre');
  const update=()=>{commands.textContent=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(manual.value)?`ollama pull ${manual.value}\n\n离线导入：先按 Ollama 文档准备 Modelfile，再运行\nollama create ${manual.value} -f Modelfile\n\n完成后点击“检测已安装模型”和“连接测试 / 预热”。`:'请输入有效模型标识';};
  manual.oninput=update;update();prepare.append(label('准备的模型',manual),commands);
  const link=element('a','Ollama 导入说明',{href:'https://docs.ollama.com/import',target:'_blank',rel:'noopener noreferrer'});prepare.append(link);
  const usage=element('pre',null,{id:'ai-usage'});
  function refreshUsage(){let input=0,output=0,unknown=0;for(const r of service.records){input+=r.usage.input||0;output+=r.usage.output||0;if(r.usage.input===null||r.usage.output===null)unknown++;}usage.textContent=`本会话 ${service.records.length} 次调用；已知输入 ${input} token，输出 ${output} token；${unknown} 次含未知用量。`;}
  dialog.append(message,prepare,element('h3','用量与授权'),usage,button('清零用量',()=>{service.clearUsage();refreshUsage();}),button('导出用量 JSON',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(service.exportUsage(),null,2)],{type:'application/json'}));const a=element('a',null,{href:url,download:'AI调用用量.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),button('撤销所有 AI 授权',()=>{service.revoke();message.textContent='已撤销授权并取消在途请求';}),button('关闭',()=>dialog.close()));
  const receipts=element('section',null,{id:'ai-receipts','aria-label':'AI 调用记录'});receipts.hidden=true;
  async function consent({root,component,tier,signal}){
    if(signal.aborted)return 'deny';
    return new Promise(resolve=>{
      const panel=element('dialog',null,{class:'ai-dialog','aria-label':'AI 能力授权'});
      panel.append(element('h2','允许此构件使用 AI 模型？'),element('p',`${tier==='cloud'?'云端服务':'本地模型'}将接收构件提交的问题与上下文。授权不包含任意网络访问。`),element('p',`组件：${component}`),element('code',root));
      let done=false;const finish=value=>{if(done)return;done=true;signal.removeEventListener('abort',abort);panel.close();panel.remove();resolve(value);};const abort=()=>finish('deny');
      panel.append(button('允许',()=>finish('allow')),button('仅本次',()=>finish('once')),button('拒绝',()=>finish('deny')));panel.oncancel=e=>{e.preventDefault();finish('deny');};signal.addEventListener('abort',abort,{once:true});document.body.append(panel);panel.showModal();
    });
  }
  let storage;try{storage=localStorage;}catch{}
  const service=new AIService({storage,consent,onRecord:({receipt,text,test,context})=>{
    refreshUsage();if(test||receipt.root_hash!==currentRoot()||context!==currentContext())return;
    receipts.hidden=false;const record=element('details');record.append(element('summary',receipt.status==='completed'?'AI 生成 · 引用可验证（宿主未核验引用，请核对书内原文）':`AI 调用：${receipt.status}`));
    if(text)record.append(element('p',text));record.append(element('p','签名证明本会话记录的内容，不证明模型回答正确。'),element('pre',JSON.stringify(receipt,null,2)));receipts.prepend(record);while(receipts.children.length>20)receipts.lastElementChild.remove();
  }});
  document.body.append(dialog);document.querySelector('main').prepend(receipts);refreshUsage();
  const open=()=>{document.getElementById('readerMenu').open=false;dialog.showModal();refreshModels();if(!crypto.subtle)message.textContent='签名需要安全上下文：请使用可信 HTTPS 或 localhost。';};
  document.getElementById('btnAI').onclick=open;
  if(new URLSearchParams(location.search).has('ai'))open();
  return {service,clear(){receipts.replaceChildren();receipts.hidden=true;}};
}
