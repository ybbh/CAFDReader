import {createHash} from 'node:crypto';
// 使用明确资源清单构建宿主，暂存成功后替换旧输出，拒绝混入电子书。
import {cp,mkdir,writeFile,rename,rm,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),out=new URL('dist-host/',root),stage=new URL(`build/host-stage-${process.pid}/`,root),backup=new URL(`build/host-previous-${process.pid}/`,root);
await mkdir(stage,{recursive:true});
const files=['ai/protocol.js','ai/service.js','ai/ui.js','ai/ai.css','index.html','shelf.js','about.js','about.css','i18n.js','platform.js','platform/browser.js','platform/native.js','platform/ai-transport.js','reader/index.html','reader/reader.css','reader/reader.js','reader/app-protocol.js','reader/caf.js','reader/caf.worker.js'];
async function*walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=new URL(entry.name+(entry.isDirectory()?'/':''),directory);if(entry.isDirectory()){if(entry.name!=='books'&&!entry.name.startsWith('.'))yield*walk(path);}else yield path;}}
try{
 // web/ 下每个运行时文件都必须在清单内，防止新增模块漏打包后运行时 404。
 const listed=new Set(files),webRoot=fileURLToPath(new URL('web/',root));
 for await(const path of walk(new URL('web/',root))){const relative=fileURLToPath(path).slice(webRoot.length);if(!listed.has(relative))throw Error(`构建清单缺少 web/${relative}`);}
 for(const file of files){const destination=new URL(file,stage);await mkdir(new URL('./',destination),{recursive:true});await cp(new URL('web/'+file,root),destination);}
 await mkdir(new URL('books/',stage),{recursive:true});await writeFile(new URL('books/catalog.json',stage),'[]\n');
 await build({stdin:{contents:"export {invoke,convertFileSrc} from '@tauri-apps/api/core';",resolveDir:fileURLToPath(root)},bundle:true,format:'esm',platform:'browser',outfile:fileURLToPath(new URL('native-api.js',stage))});
 const metadata=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 const specification=JSON.parse(await readFile(new URL('spec/version.json',root),'utf8'));
 await writeFile(new URL('app-info.json',stage),JSON.stringify({version:metadata.version,spec_version:specification.version,container:specification.container,capability:specification.capability,application_protocol:specification.application_protocol},null,2)+'\n');
 const entries={};
 for(const file of [...files,'app-info.json','books/catalog.json','native-api.js'].sort())entries[file]=createHash('sha256').update(await readFile(new URL(file,stage))).digest('hex');
 await writeFile(new URL('release.json',stage),JSON.stringify({schema_version:1,product:'cafd-reader',version:metadata.version,spec_version:specification.version,files:entries},null,2)+'\n');
 let previous=false;try{await rename(out,backup);previous=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 try{await rename(stage,out);}catch(error){if(previous)await rename(backup,out);throw error;}
 if(previous)await rm(backup,{recursive:true});
 console.log('Host built: dist-host (explicit asset list, no document content)');
}finally{await rm(stage,{recursive:true,force:true});}
