import {createServer as httpServer} from 'node:http';
import {createReader, ReaderError} from './reader.mjs';
import {extractCar} from './extract.mjs';

const MAX_REQUEST = 512 * 1024;
async function readBody(req) {
  let n=0; const parts=[];
  for await(const part of req) {
    n += part.length;
    if(n>MAX_REQUEST) throw new ReaderError('REQUEST_TOO_LARGE',413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new ReaderError('INVALID_JSON',400); }
}
function json(res, status, data) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
export function createReaderServer(reader=createReader()) {
  return httpServer(async(req,res)=>{
    try {
      const path=(req.url||'').split('?')[0];
      if(req.method==='GET' && path==='/health') return json(res,200,{service:'auto-world-reader-poc',status:'ok',mode:'prototype'});
      if(req.method==='POST' && path==='/v1/extract') {
        const body=await readBody(req);
        if(typeof body.html!=='string') throw new ReaderError('HTML_REQUIRED',400);
        return json(res,200,extractCar(body.html));
      }
      if(req.method==='POST' && path==='/v1/read') {
        const body=await readBody(req);
        return json(res,200,await reader.read(body));
      }
      return json(res,404,{error:'NOT_FOUND'});
    } catch(err) {
      const code=err instanceof ReaderError ? err.code : 'INTERNAL_ERROR';
      return json(res,err instanceof ReaderError ? err.status : 500,{error:code});
    }
  });
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  const port=Number(process.env.READER_PORT ?? 8787);
  const server=createReaderServer();
  server.listen(port,'127.0.0.1',()=>{
    console.log(JSON.stringify({service:'reader-poc',url:`http://127.0.0.1:${server.address().port}`,mode:'offline-extract',remoteSources:'disabled'}));
  });
}