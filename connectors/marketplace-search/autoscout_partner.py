"""Read an AutoScout24 EU partner search using an operation supplied under contract.

The named query must return an array at rows_path. Brand-specific schema fields
are projected using field_paths in the contract file. A separate public dealer
example mode validates the documented fixture; it never calls marketplace search.
"""
import argparse
import json
import os
import re
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from private_rows import write_rows

FIXTURE = 'https://listing-creation.api.autoscout24.com/assets/docs/read-car.json'
TAXONOMY = 'https://listing-creation.api.autoscout24.com/makes'
FIELDS = ('source_id', 'source_url', 'title', 'price', 'currency', 'year', 'mileage_km')
ORIGINS = {'www.autoscout24.' + tld for tld in ('fr','de','at','be','nl','lu','it','es','com')}
UUID_PATTERN = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', re.I)
DETAIL_PATH = re.compile(r'/(?:[a-z]{2}/)?(?:offres|offers|angebote|aanbod|annunci|anuncios|ofertas)/[^/]+/?$')
API_DOMAINS = ('autoscout24.com', 'as24.tech', 'autoscout24.fr', 'autoscout24.de', 'autoscout24.at',
               'autoscout24.be','autoscout24.nl','autoscout24.lu','autoscout24.it','autoscout24.es')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, headers=None, payload=None):
    data = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
    meta = {'User-Agent':'AutoFindex/1.0 (partner integration validation)', 'Accept':'application/json'}
    if data is not None:
        meta['Content-Type'] = 'application/json'
    request = Request(url, data=data, headers={**meta, **(headers or {})})
    try:
        with build_opener(NoRedirect()).open(request, timeout=20) as res:
            if res.status != 200 or 'json' not in res.headers.get_content_type().lower():
                raise ValueError('A JSON HTTP 200 response was required')
            body = res.read(4_000_001)
    except HTTPError as e:
        raise ValueError(f'AutoScout24 returned HTTP {e.code}; no retry') from None
    except (URLError, OSError) as e:
        raise ValueError(f'AutoScout24 connection failed ({type(e).__name__})') from None
    if len(body) > 4_000_000:
        raise ValueError('Pilot response exceeds four megabytes')
    return json.loads(body, parse_float=Decimal)


def at(obj, path):
    if not isinstance(path, list) or not all(isinstance(k,str) and k for k in path):
        raise ValueError('A projection path must be an array of JSON object keys')
    for key in path:
        if not isinstance(obj, dict) or key not in obj:
            return None
        obj = obj[key]
    return obj


def normalize(values):
    key = values['source_id']
    url = values['source_url']
    if not isinstance(key, str) or not key.strip() or key != key.strip() or len(key)>255 or any(ord(c)<32 for c in key):
        return None
    if not isinstance(url,str) or len(url)>4096 or any(ch.isspace() or ord(ch)<32 or ch=="\\" for ch in url):
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if not parts or parts.scheme != 'https' or parts.netloc not in ORIGINS or not DETAIL_PATH.fullmatch(parts.path):
        return None
    url_ids = UUID_PATTERN.findall(parts.path)
    if (url_ids and {i.lower() for i in url_ids} != {key.lower()}) or (UUID_PATTERN.fullmatch(key) and not url_ids):
        return None
    title = values['title']
    amount = values['price']
    currency = values['currency']
    year = values['year']
    distance = values['mileage_km']
    if isinstance(year,str):
        match = re.fullmatch(r'(\d{4})(?:-(?:0[1-9]|1[012])(?:-\d{2})?)?',year)
        if not match:
            return None
        if len(year)==10:
            try:
                date.fromisoformat(year)
            except ValueError:
                return None
        year = int(match[1])
    if not isinstance(title,str) or not title.strip() or type(year) != int or not (1886<=year<=date.today().year+1):
        return None
    if not isinstance(amount,(str,int,Decimal)) or not re.fullmatch(r'[0-9]{1,15}(?:\.[0-9]{1,2})?', str(amount)) or Decimal(str(amount))<=0:
        return None
    if not isinstance(currency,str) or not re.fullmatch(r'[A-Z]{3}',currency):
        return None
    if type(distance) != int or distance<0:
        return None
    return dict(source='autoscout24',source_id=key,source_url=url,title=title.strip(),
                price=format(Decimal(str(amount)),'.2f'),currency=currency,year=year,mileage_km=distance)


def sample(rows, paths):
    if set(paths) != set(FIELDS) or not all(isinstance(p,list) and p for p in paths.values()):
        raise ValueError('field_paths must specify all seven normalized fields')
    selected = {}
    seen = set()
    duplicates = 0
    conflicts = set()
    incomplete = 0
    for raw in rows:
        row = normalize({key:at(raw,paths[key]) for key in FIELDS})
        if row is None:
            incomplete += 1
            continue
        key = row['source_id']
        if key in seen:
            duplicates += 1
            if row != selected[key]:
                conflicts.add(key)
        else:
            selected[key] = row
            seen.add(key)
    accepted = [row for key,row in selected.items() if key not in conflicts]
    return dict(records_observed=len(rows),complete_unique=len(accepted),duplicates=duplicates,
                conflicting_ids=len(conflicts),incomplete=incomplete), accepted


def partner_search(config_path, limit, auth_value, fetch=request_json):
    if type(limit) != int or not 1<=limit<=10:
        raise ValueError('The pilot limit must be between 1 and 10')
    cfg = json.loads(config_path.read_text(encoding='utf-8'))
    environment = cfg.get('environment')
    if environment not in ('production','sandbox'):
        raise ValueError('Specify the partner-issued environment as production or sandbox')
    # Pin exact authority and refuse redirects before transmitting either query or secret.
    end = urlsplit(cfg['endpoint'])
    origin = urlsplit(cfg['trusted_origin'])
    if (end.scheme != 'https' or origin.scheme != 'https' or end.netloc != origin.netloc or
            origin.path not in ('','/') or origin.query or origin.fragment or end.query or end.fragment or
            not re.fullmatch(r'[a-z0-9.-]+',end.netloc) or not end.path.startswith('/') or end.path=='/' or
            not any(end.netloc==d or end.netloc.endswith('.'+d) for d in API_DOMAINS)):
        raise ValueError('Require the exact contracted HTTPS API origin and endpoint')
    query = (config_path.parent / cfg['query_file']).read_text(encoding='utf-8-sig')
    # Selecting this declared query by its name makes other GraphQL operations in the
    # document unreachable. Per GraphQL spec duplicate operation names must be rejected.
    first = re.match(r'(?:[\s,]|#[^\r\n]*(?:\r?\n|$))*query\s+([_A-Za-z][_0-9A-Za-z]*)\b',query)
    if not first or first[1] != cfg['operation_name']:
        raise ValueError('Require the declared, named read-only query as the first operation')
    if not auth_value or any(ord(c)<32 for c in auth_value):
        raise ValueError('Set AUTOSCOUT24_SEARCH_AUTHORIZATION to the issued header value')
    variables = cfg['variables']
    page_size = cfg['limit_variable_path']
    if not isinstance(page_size,list) or not page_size or not all(isinstance(p,str) and p for p in page_size):
        raise ValueError('Set the query’s documented page-size variable path')
    parent=at(variables,page_size[:-1])
    if not isinstance(parent,dict) or page_size[-1] not in parent:
        raise ValueError('Page-size variable is missing in variables')
    parent[page_size[-1]]=limit
    header=cfg.get('auth_header', 'Authorization')
    if header.lower() not in ('authorization','x-api-key','api-key'):
        raise ValueError('Unsupported authentication header')
    doc=fetch(cfg['endpoint'], {header:auth_value},
              {'query':query,'operationName':first[1],'variables':variables})
    if not isinstance(doc,dict) or doc.get('errors') or not isinstance(doc.get('data'),dict):
        raise ValueError('Search returned GraphQL errors or omitted data')
    rows=at(doc['data'],cfg['rows_path'])
    if not isinstance(rows,list) or len(rows)>limit:
        raise ValueError('Response did not honor the configured row path or pilot page size')
    summary, accepted = sample(rows,cfg['field_paths'])
    summary['mode'] = 'contracted-marketplace-read' if environment == 'production' else 'partner-sandbox'
    return summary, accepted


def dealer_example(fetch=request_json):
    ref=fetch(TAXONOMY)['makes']
    vehicle=fetch(FIXTURE)
    makes=[m for m in ref if m['id']==vehicle['make']]
    if len(makes)!=1:
        raise ValueError('Fixture make is absent or ambiguous in the reference data')
    models=[m for m in makes[0]['models'] if m['id']==vehicle['model'] and m['vehicleType']==vehicle['vehicleType']]
    if len(models)!=1 or vehicle['mileageUnit']!='km':
        raise ValueError('Fixture model or odometer unit cannot be verified')
    urls={c['url'] for c in vehicle['publication']['channels'] if c.get('id')=='AS24' and c.get('url')}
    price=vehicle['prices']['public']
    values=dict(source_id=vehicle['id'],source_url=next(iter(urls)) if len(urls)==1 else None,
                title=' '.join(filter(None,[makes[0]['name'],models[0]['name'],vehicle.get('modelVersion')])),
                price=price['price'],currency=price['currency'],year=vehicle['firstRegistrationDate'],
                mileage_km=vehicle['mileage'])
    row=normalize(values)
    if not row:
        raise ValueError('Incomplete official fixture')
    return dict(mode='official-dealer-documentation-example',reference_makes=len(ref),
                reference_model_entries=sum(len(m['models']) for m in ref),title_derived=True,
                fixture_publication_status=vehicle['publication']['status'],example_rows=1,
                live_marketplace_rows=0), row


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--contract',type=Path)
    group.add_argument('--dealer-example',action='store_true')
    parser.add_argument('--limit',type=int,default=3)
    parser.add_argument("--output", type=Path, help="Write accepted rows to a new private JSON file.")
    args=parser.parse_args()
    try:
        if args.dealer_example:
            summary, example = dealer_example()
            rows = [example]
        else:
            summary,rows=partner_search(args.contract,args.limit,os.environ.get('AUTOSCOUT24_SEARCH_AUTHORIZATION',''))
        if args.output:
            write_rows(args.output, 'autoscout24', summary['mode'], rows)
    except (KeyError, OSError, ValueError, TypeError) as e:
        parser.exit(2,f'AutoScout24: {e}\n')
    print(json.dumps(summary,ensure_ascii=False,sort_keys=True))


if __name__=='__main__':
    main()
