"""Offline contract-shape and integrity tests; tests never use live partner credentials."""
import json
from pathlib import Path
import tempfile
import unittest
from autoscout_partner import FIELDS, NoRedirect, dealer_example, normalize, partner_search, sample

def shape():
    return dict(source_id='car-one',source_url='https://www.autoscout24.fr/offres/car-one',
                title='Stock test',price=10000,currency='EUR',year='2020-03',mileage_km=12345)


class PartnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'contract.json'
        # A reserved local fixture. This host is never used for real HTTP.
        self.cfg=dict(environment='production',endpoint='https://example.as24.tech/gql',trusted_origin='https://example.as24.tech',
                      query_file='query.graphql',operation_name='Demo',variables={'page':{'size':None}},
                      limit_variable_path=['page','size'],rows_path=['result'],
                      field_paths={f:[f] for f in FIELDS})
        self.write_config()
        self.query= self.path.parent/'query.graphql'
        self.query.write_text('# offline test\nquery Demo($page: Json!) { result(page: $page) { title } }')

    def write_config(self):
        self.path.write_text(json.dumps(self.cfg))

    def test_one_page_and_normalization(self):
        calls=[]
        def fake(endpoint,headers,payload):
            calls.append((endpoint,headers,payload))
            return {'data':{'result':[shape(),shape()]}}
        totals,rows=partner_search(self.path,2,'opaque-test',fake)
        self.assertEqual((len(calls),totals['complete_unique'],totals['duplicates'],rows[0]['year']), (1,1,1,2020))
        self.assertEqual(calls[0][2]['variables'],{'page':{'size':2}})
        self.assertEqual(calls[0][2]['operationName'],'Demo')

    def test_wrong_origin_blocked_and_no_redirect(self):
        for changes in [
            {'endpoint':'https://example.as24.tech.bad.example/path'},
            {'trusted_origin':'https://sibling.as24.tech'},
            {'endpoint':'https://unrelated.example/path','trusted_origin':'https://unrelated.example'}]:
            orig=self.cfg.copy();self.cfg.update(changes);self.write_config()
            with self.assertRaises(ValueError):
                partner_search(self.path,1,'test',lambda *args:self.fail('must not send'))
            self.cfg=orig
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))

    def test_write_operation_or_missing_secret(self):
        with self.assertRaises(ValueError):
            partner_search(self.path,1,'',lambda *args:self.fail('must not send'))
        self.query.write_text('mutation Demo { unrelated }')
        with self.assertRaises(ValueError):
            partner_search(self.path,1,'test',lambda *args:self.fail('must not send'))

    def test_errors_or_overread(self):
        for response in [{'data':{'result':[shape(),shape()]}},{'data':{'result':[]}, 'errors':[{}]}, {'data':{}}]:
            with self.assertRaises(ValueError):
                partner_search(self.path,1,'opaque',lambda *a:response)

    def test_conflicts_and_incomplete(self):
        raw=shape()
        rows=[raw, {**raw,'price':9100}, {**raw,'source_id':'other','mileage_km':None}]
        totals,found=sample(rows,{f:[f] for f in FIELDS})
        self.assertEqual(found,[])
        self.assertEqual(totals['conflicting_ids'],1)
        self.assertEqual(totals['incomplete'],1)

    def test_unsafe_links_or_missing_actual_fields(self):
        for replacement in [
            {'source_url':'https://www.autoscout24.fr.evil.test/test'}, {'source_url':'https://www.autoscout24.fr'},
            {'source_url':'https://u:p@www.autoscout24.fr/test'}, {'year':'2020-99'}, {'year':'2020-02-31'}, {'source_url':'https://www.autoscout24.fr/lst?q=car-one'},
            {'source_url':'https://www.autoscout24.fr/offres/alfa-11111111-1111-4222-accc-000000000000'},
            {'price':False}, {'price':float('inf')}, {'mileage_km':-1}]:
            self.assertIsNone(normalize({**shape(),**replacement}))

    def test_native_uuid_and_price(self):
        native='22222222-2222-4222-abbb-111111111111'
        value={**shape(),'source_url':'https://www.autoscout24.fr/offres/alfa-'+native,'source_id':native,'price':'12000.20'}
        self.assertEqual(normalize(value)['price'],'12000.20')
        self.assertIsNone(normalize({**value,'source_id':'44444444-2222-4222-abbb-111111111111'}))
        self.assertIsNone(normalize({**value,'source_url':'https://www.autoscout24.fr/professionnels/'+native}))

    def test_fixture_not_counted_as_live(self):
        taxonomy={'makes':[{'id':41,'name':'Test make','models':[{'id':17,'vehicleType':'C','name':'Stored model'}]}]}
        fixture={'id':'fixture','make':41,'model':17,'vehicleType':'C','mileageUnit':'km','mileage':5500,
                 'firstRegistrationDate':'2018-03','publication':{'status':'Inactive','channels':[
                     {'id':'AS24','url':'https://www.autoscout24.fr/offres/fixture'}]},
                 'prices':{'dealer':{'price':200,'currency':'EUR'},'public':{'price':1000,'currency':'EUR'}}}
        def fake(url): return taxonomy if url.endswith('/makes') else fixture
        counts,row=dealer_example(fake)
        self.assertEqual((counts['live_marketplace_rows'],row['price'],row['title']),(0,'1000.00','Test make Stored model'))


if __name__=='__main__':
    unittest.main()
