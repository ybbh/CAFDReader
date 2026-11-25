// Requires a built host and LLM fixture. Serve dist-host at BASE before running.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,firefox,webkit} from 'playwright-core';
const base=process.env.BASE||'http://127.0.0.1:8612';
const fixture=fileURLToPath(new URL('../build/llm-fixture.cafd',import.meta.url));
await readFile(fixture);
const report=[];
for(const [name,engine] of [['chrome',chromium],['firefox',firefox],['webkit',webkit]]){
 let browser;
 try{
  const executablePath=process.env[`CAFD_${name.toUpperCase()}_EXECUTABLE`];
  browser=await engine.launch({headless:true,...(executablePath?{executablePath}:name==='chrome'?{channel:'chrome'}:{})});
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
   const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));let requests=0,modelList=[{name:'llama3.2:3b',digest:'a'.repeat(64)}],modelStatus=200;
   await page.route(/^http:\/\/(localhost|127\.0\.0\.1):11434\//,route=>{
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(route.request().url().endsWith('/api/tags'))return route.fulfill({headers,status:modelStatus,json:{models:modelList}});
    requests++;return route.fulfill({headers,json:{message:{content:'已完成本地模型调用'},prompt_eval_count:10,eval_count:8}});
   });
   await page.goto(base+'/reader/');
   await page.setInputFiles('#fileInput',fixture);await page.locator('#bookApp').waitFor();
   let frame=await(await page.locator('#bookApp').elementHandle()).contentFrame();
   await frame.locator('#ask').click();await frame.waitForFunction(()=>JSON.parse(document.querySelector('#result').textContent).status==='unavailable');
   await page.locator('#readerMenu > summary').click();await page.locator('#btnAI').click();
   // Opening settings discovers models without requiring the manual button.
   await page.waitForFunction(()=>document.querySelector('#ai-local-model').value==='llama3.2:3b');
   assert.equal(await page.locator('#ai-local-model').isEnabled(),true);
   modelList=[];await page.getByRole('button',{name:'检测已安装模型',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#ai-local-model-status').textContent.includes('尚未安装模型'));
   assert.equal(await page.locator('#ai-local-model').isDisabled(),true);
   assert.equal(await page.locator('#ai-local-model option').textContent(),'未发现已安装模型');
   modelStatus=403;await page.getByRole('button',{name:'检测已安装模型',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#ai-local-model-status').textContent.includes('无法读取模型'));
   assert.equal(await page.locator('#ai-local-model option').textContent(),'模型读取失败，请重新检测');
   modelStatus=200;modelList=[{name:'llama3.2:3b',digest:'a'.repeat(64)}];
   await page.locator('#ai-local-url').fill('http://127.0.0.1:11434');
   assert.equal(await page.locator('#ai-local-model').isDisabled(),true);
   await page.locator('#ai-local-url').press('Tab');
   await page.waitForFunction(()=>document.querySelector('#ai-local-model').value==='llama3.2:3b');
   await page.locator('fieldset').first().getByRole('button',{name:'连接测试 / 预热',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('连接成功'));
   await page.locator('.ai-dialog').getByRole('button',{name:'关闭',exact:true}).click();
   await frame.locator('#ask').click();const consent=page.getByRole('dialog',{name:'AI 能力授权',exact:true});await consent.waitFor();await consent.getByRole('button',{name:'拒绝',exact:true}).click();
   await frame.waitForFunction(()=>JSON.parse(document.querySelector('#result').textContent).status==='denied');assert.equal(requests,1);
   await frame.locator('#ask').click();await consent.getByRole('button',{name:'仅本次',exact:true}).click();
   await frame.waitForFunction(()=>JSON.parse(document.querySelector('#result').textContent).status==='completed');
   const answer=JSON.parse(await frame.locator('#result').textContent());assert.equal(answer.receipt.model,'llama3.2:3b');
   assert.ok(await page.evaluate(async receipt=>{const {verifyReceipt}=await import('../ai/service.js');return verifyReceipt(receipt);},answer.receipt));
   assert.ok(!JSON.stringify(answer).includes('http://127.0.0.1:11434'));
   assert.ok(await page.locator('#ai-receipts').isVisible());
   assert.ok(await frame.evaluate(()=>{try{parent.document.body;return false;}catch{return true;}}));
   assert.ok(await frame.evaluate(()=>{try{localStorage.getItem('x');return false;}catch{return true;}}));
   assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>localStorage.getItem(k).includes('11434'))),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#btnClose').click();await page.setInputFiles('#fileInput',fixture);await page.locator('#bookApp').waitFor();frame=await(await page.locator('#bookApp').elementHandle()).contentFrame();
   await frame.locator('#ask').click();await consent.waitFor();await consent.getByRole('button',{name:'拒绝',exact:true}).click();
   assert.deepEqual(pageErrors,[]);await context.close();
   report.push({browser:name,version:browser.version(),width,status:'passed'});
  }
 }catch(error){report.push({browser:name,status:'failed',error:error.message});process.exitCode=1;}
 finally{await browser?.close();}
}
await mkdir(new URL('../build/',import.meta.url),{recursive:true});
await writeFile(new URL('../build/llm-browser-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const row of report)console.log(`${row.status.toUpperCase()} ${row.browser}${row.width?' '+row.width+'px':''}${row.error?' '+row.error.split('\n')[0]:''}`);
