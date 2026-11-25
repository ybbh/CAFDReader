// 桌面宿主的 AI 传输：经原生代理访问 ~/.cafdreader/cfg.toml 允许的端点，不占用页面 CSP 的 connect-src。
export function createNativeAITransport(call){
  let next=0;
  return async(url,init={})=>{
    const signal=init.signal,id=`ai-${Date.now()}-${++next}`;
    if(signal?.aborted)throw new Error('AI 请求已取消');
    const headers={};new Headers(init.headers||{}).forEach((value,key)=>headers[key]=value);
    const request={id,method:(init.method||'GET').toUpperCase(),url:String(url),headers,body:typeof init.body==='string'?init.body:null};
    const send=call('ai_fetch',{request}).catch(error=>{throw error instanceof Error?error:new Error(String(error));});
    const reply=await (signal?Promise.race([send,new Promise((_,reject)=>signal.addEventListener('abort',()=>{call('ai_abort',{id}).catch(()=>{});reject(new Error('AI 请求已取消'));},{once:true}))]):send);
    return new Response(new Uint8Array(reply.body),{status:reply.status});
  };
}
