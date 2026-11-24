import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractCar} from '../src/extract.mjs';
import {createReader,ReaderError} from '../src/reader.mjs';
import {createReaderServer} from '../src/server.mjs';

const html=await readFile(new URL('../fixtures/car.html',import.meta.url),'utf8');
const updated=await readFile(new URL('../fixtures/car-update.html',import.meta.url),'utf8');
const shell=await readFile(new URL('../fixtures/app-shell.html',import.meta.url),'utf8');
const url='https://fixtures.autofindex.example/car/911';
const source={enabled:true,fixtureOnly:true,rightsStatus:'permitted_crawl',evidenceRef:'TEST_FIXTURE_NOT_REAL_AUTH',allowedOrigins:['https://fixtures.autofindex.example'],cacheTtlMs:15000,allowBrowser:true};
const resp=(body,options={})=>new Response(body,{status:options.status??200,headers:{'content-type':'text/html',...options.headers}});
function setup(fetchImpl,extra={}){return createReader({sources:{demo:source},fixtureTransport:true,fetchImpl,...extra});}

test('JSON-LD vehicle maps exact structured fields with provenance',()=>{
 const r=extractCar(html,{extractedAt:'2026-11-24T00:00:00.000Z'});
 assert.equal(r.title,'Porsche 911 Carrera 2022 (fictif)');
 assert.equal(r.make,'Porsche'); assert.equal(r.model,'911 Carrera');
 assert.equal(r.year,2022);assert.equal(r.odometerKm,35000);
 assert.deepEqual(r.price,{amount:119900,currency:'EUR'});
 assert.equal(r.completeness.requiredFilled,5);assert.match(r.evidence.rawSha256,/^[a-f0-9]{64}$/);
});
test('unrelated price and year in markup are not combined into a vehicle',()=>{
 const r=extractCar('<title>Le marché des voitures 2022</title><div>Annonce 90000€ 50000 km</div>');
 assert.equal(r.price.amount,null); assert.equal(r.year,null);assert.equal(r.odometerKm,null);
});
test('cache hit and explicit refresh with accurate price change',async()=>{
 let count=0;
 const reader=setup(async()=>resp(count++ ? updated:html),{now:()=>10000});
 const first=await reader.read({sourceId:'demo',url});
 const second=await reader.read({sourceId:'demo',url});
 const third=await reader.read({sourceId:'demo',url,refresh:true});
 assert.equal(first.price.amount,119900);assert.equal(second.cacheHit,true);
 assert.equal(third.price.amount,115900);assert.equal(count,2);
 assert.deepEqual(third.changes,[{field:'odometerKm',from:35000,to:35500},{field:'price.amount',from:119900,to:115900}]);
 assert.equal(reader.stats().cacheHits,1);
});
test('expired cache leads to conditional revalidation; 304 preserves record',async()=>{
 let clock=10000, count=0, header;
 const reader=setup(async(_,opts)=>{header=opts.headers;count++;return count===1?resp(html,{headers:{etag:'"abc"'}}):new Response(null,{status:304,headers:{etag:'"abc"'}})},{now:()=>clock});
 await reader.read({sourceId:'demo',url}); clock+=20000;
 const rechecked=await reader.read({sourceId:'demo',url});
 assert.equal(rechecked.unchanged,true); assert.equal(rechecked.price.amount,119900);
 assert.equal(header['If-None-Match'],'"abc"');assert.equal(reader.stats().notModified,1);
});
test('dynamic app shell uses optional injected browser only when necessary',async()=>{
 let rendered=0;
 const reader=setup(async()=>resp(shell),{renderBrowser:async()=>{rendered++;return html;}});
 const result=await reader.read({sourceId:'demo',url});
 assert.equal(rendered,1);assert.equal(result.engine,'browser');assert.equal(result.make,'Porsche');
});
test('no browser fallback after HTTP 403',async()=>{
 let rendered=0;
 const reader=setup(async()=>resp('blocked',{status:403}),{renderBrowser:async()=>{rendered++;return html;}});
 await assert.rejects(reader.read({sourceId:'demo',url}),e=>e instanceof ReaderError && e.code==='ACCESS_DENIED');
 assert.equal(rendered,0);
});
test('no captcha/challenge solving or follow-up request',async()=>{
 let count=0;
 const reader=setup(async()=>{count++;return resp('<title>DataDome device check captcha</title>');});
 await assert.rejects(reader.read({sourceId:'demo',url}),e=>e.code==='VERIFICATION_REQUIRED');
 assert.equal(count,1);
});
test('source authorization and exact origin validation',async()=>{
 let count=0;const reader=setup(async()=>{count++;return resp(html)});
 for(const item of [{sourceId:'unknown',url},{sourceId:'demo',url:'https://leboncoin.fr/car/1'},{sourceId:'demo',url:'http://fixtures.autofindex.example/car/1'},{sourceId:'demo',url:'https://user:pass@fixtures.autofindex.example/car/1'},{sourceId:'demo',url:'https://127.0.0.1/test'}]){
   await assert.rejects(reader.read(item),e=>e instanceof ReaderError);
 }
 assert.equal(count,0);
});
test('an externally declared source never bypasses missing authorization',async()=>{
 const reader=createReader({sources:{demo:{...source,evidenceRef:'',fixtureOnly:false}},fetchImpl:async()=>{throw Error('must not run')}});
 await assert.rejects(reader.read({sourceId:'demo',url}),e=>e.code==='SOURCE_NOT_AUTHORIZED');
});
test('streaming byte limit blocks oversized page and redirects fail closed',async()=>{
 const big=setup(async()=>resp('X'.repeat(4000)),{maxBytes:2048});
 await assert.rejects(big.read({sourceId:'demo',url}),e=>e.code==='PAGE_TOO_LARGE');
 const redirect=setup(async()=>new Response(null,{status:302,headers:{location:'https://example.com'}}));
 await assert.rejects(redirect.read({sourceId:'demo',url}),e=>e.code==='REDIRECT_DISALLOWED');
});
test('offline extraction API works, default remote reader denies access',async()=>{
 const server=createReaderServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
 const base=`http://127.0.0.1:${server.address().port}`;
 const health=await (await fetch(base+'/health')).json();assert.equal(health.status,'ok');
 const response=await fetch(base+'/v1/extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({html})});
 assert.equal(response.status,200);assert.equal((await response.json()).odometerKm,35000);
 const denied=await fetch(base+'/v1/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceId:'demo',url})});
 assert.equal(denied.status,403); assert.equal((await denied.json()).error,'SOURCE_NOT_AUTHORIZED');
 } finally { await new Promise(resolve=>server.close(resolve)); }
});