import {createHash} from 'node:crypto';
import {extractCar} from './extract.mjs';

/** Extract multiple structured car cards from a licensed source's ItemList JSON-LD. */
export function extractListingPage(html, {baseUrl, limit=100}={}) {
  if (typeof html !== 'string' || !html.trim()) throw new TypeError('HTML_EMPTY');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('INVALID_LIMIT');
  let base=null;
  if (baseUrl) {
    base=new URL(baseUrl);
    if (base.protocol!=='https:') throw new TypeError('INVALID_BASE_ORIGIN');
  }
  const cards=[];
  const seen=new Set();
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(m=>/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)(?:\s|$)/i.test(m[1]));
  for(const [, , body] of scripts) {
    let obj;
    try { obj=JSON.parse(body.trim()); } catch { continue; }
    const queue=Array.isArray(obj) ? [...obj] : [obj];
    for(let i=0;i<queue.length;i++) {
      const entry=queue[i];
      if (!entry || typeof entry!=='object') continue;
      if (Array.isArray(entry['@graph'])) queue.push(...entry['@graph']);
      const types=Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']];
      if (!types.some(v=>v==='ItemList' || v==='https://schema.org/ItemList')) continue;
      if (!Array.isArray(entry.itemListElement)) continue;
      for(const element of entry.itemListElement) {
        if (cards.length>=limit) break;
        const item=element?.item ?? element;
        if (!item || typeof item!=='object') continue;
        const cardTypes=Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (!cardTypes.some(v=>['Car','Vehicle','Product','https://schema.org/Car','https://schema.org/Vehicle','https://schema.org/Product'].includes(v))) continue;
        const href=item.url ?? item['@id'];
        if (typeof href!=='string') continue;
        let target;
        try { target=new URL(href,base??undefined); } catch { continue; }
        if (target.protocol!=='https:' || target.username || target.password || target.hash ||
            (base && target.origin!==base.origin)) continue;
        const normalized=target.href;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const car=extractCar(`<script type="application/ld+json">${JSON.stringify(item)}</script>`,{extractedAt:new Date().toISOString()});
        if (car.completeness.requiredFilled < 2) continue;
        cards.push({url:normalized,position:Number.isInteger(element?.position)?element.position:null,
          title:car.title,make:car.make,model:car.model,year:car.year,odometerKm:car.odometerKm,
          price:car.price,completeness:car.completeness});
      }
    }
  }
  return {schemaVersion:1,kind:'listing-page',count:cards.length,items:cards,
    evidence:{method:'json-ld-itemlist',rawSha256:createHash('sha256').update(html).digest('hex')}};
}