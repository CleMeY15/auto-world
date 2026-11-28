"""Destination policy checks. All invocations targeting autoworld use a mocked SQL boundary."""
import hashlib
import json
from subprocess import CompletedProcess
import unittest
from unittest.mock import patch

from reader_pg import clean, import_observations, psql, validate_database_name


class ProjectDestinationTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(source='mobile.de', source_id='400', source_url='https://suchen.mobile.de/fahrzeuge/details.html?id=400',
                        title='QA', currency='EUR', price='18000.00', year=2020, mileage_km=50000)
        self.item = dict(provenance='direct-origin', document_sha256=hashlib.sha256(b'QA').hexdigest(), row=self.row)

    def test_explicit_destination_names(self):
        for name in ('autoworld', 'autofindex_trial_my'):
            self.assertEqual(validate_database_name(name), name)
        for name in (None, [], 'AutoWorld', 'autoworld2', 'autoworld ', 'host=localhost dbname=autoworld',
                     'postgres', 'autofindex_trial_', 'postgresql://user@server/autoworld'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_database_name(name)

    def test_direct_mobile_identity_only_and_mixed_batch_is_atomic(self):
        different = self.row | dict(source='leparking.fr', source_id='Q0TEST01',
                                    source_url='https://www.leparking.fr/voiture-occasion-detail/test/example/Q0TEST01.html')
        for bad in ([self.item | {'provenance': state} for state in ('synthetic','archived','indirect','indexed')]
                    + [self.item | {'row': different}, self.item | {'row': self.row | {'source_id':'401'}}]):
            with self.subTest(bad=bad), patch('reader_pg.psql') as db:
                with self.assertRaises(ValueError):
                    import_observations('autoworld', [self.item,bad])
                db.assert_not_called()

    def test_project_positive_uses_only_pilot_schema_and_separate_readback(self):
        normalized = clean(self.item)
        with patch('reader_pg.psql',side_effect=['1', json.dumps([normalized])]) as db:
            receipt = import_observations('autoworld', [self.item])
        self.assertEqual((receipt['inserted'],receipt['verified'],receipt['table']), (1,1,'aw_html_trial.observations'))
        self.assertEqual([c.args[0] for c in db.call_args_list], ['autoworld','autoworld'])
        self.assertIn('INSERT INTO aw_html_trial.observations', db.call_args_list[0].args[1])

    def test_foreign_and_multi_host_refused_before_psql(self):
        for env in ({'PGHOST':'db.example.org'}, {'PGHOSTADDR':'192.0.2.4'}, {'PGSERVICE':'prod'},
                    {'PGHOST':'/run/postgresql,db.example.org'}, {'PGHOST':'localhost','PGHOSTADDR':'127.0.0.1,192.0.2.4'}):
            with self.subTest(env=env), patch.dict('os.environ',env,clear=True), patch('reader_pg.subprocess.run') as call:
                with self.assertRaises(ValueError):
                    psql('autoworld','SELECT 1')
                call.assert_not_called()
        with patch.dict('os.environ',{'PGHOST':'/run/postgresql'},clear=True), patch('reader_pg.subprocess.run', return_value=CompletedProcess([],0,'1','')) as call:
            self.assertEqual(psql('autoworld','SELECT 1'), '1')
            self.assertEqual(call.call_args.args[0][-1], 'autoworld')


if __name__ == '__main__':
    unittest.main()
