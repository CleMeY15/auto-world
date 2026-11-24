import hashlib
import unittest
from unittest.mock import patch

from custom_detail import parse_detail
from reader_pg import clean, import_observations, psql


class ReaderPgTests(unittest.TestCase):
    def setUp(self):
        source = b'<h1>Probe</h1><p>Preis: 2.100,50 EUR</p><p>Erstzulassung: 04/2021</p><p>Kilometerstand: 0 km</p>'
        self.row = parse_detail(source, 'https://suchen.mobile.de/fahrzeuge/details.html?id=91')
        self.item = dict(row=self.row, provenance='synthetic', document_sha256=hashlib.sha256(source).hexdigest())

    def test_exact_price_zero_mileage_and_provenance(self):
        result = clean(self.item)
        self.assertEqual((result['price'], result['mileage_km'], result['provenance']), ('2100.50', 0, 'synthetic'))

    def test_source_identity_and_untraceable_input_rejected(self):
        for item in (self.item | {'provenance': 'unclear'},
                     self.item | {'document_sha256': ''},
                     self.item | {'row': self.row | {'source_id': '92'}},
                     self.item | {'row': self.row | {'source': 'other'}},
                     self.item | {'row': self.row | {'currency': 'DKK'}},
                     self.item | {'row': self.row | {'mileage_km': None}}):
            with self.subTest(item=item):
                with self.assertRaises(ValueError):
                    clean(item)

    def test_currency_is_preserved_without_conversion(self):
        for code in ('CHF', 'GBP', 'USD'):
            result = clean(self.item | {'row': self.row | {'currency': code}})
            self.assertEqual((result['price'], result['currency']), ('2100.50', code))

    def test_separate_parking_identity(self):
        url = 'https://www.leparking.fr/voiture-occasion-detail/test/example/Q0TEST01.html'
        item = self.item | {'row': self.row | {'source': 'leparking.fr', 'source_id': 'Q0TEST01', 'source_url': url}}
        self.assertEqual(clean(item)['source'], 'leparking.fr')
        labelled = item['row'] | {'origin_domains':['WWW.AUTOSCOUT24.FR','autoscout24.fr','mobile.de'],
                                  'origin_platforms':['AutoScout24','mobile.de','AutoScout24']}
        preserved = clean(item | {'row':labelled})
        self.assertEqual(preserved['origin_domains'], ['autoscout24.fr','mobile.de'])
        self.assertEqual(preserved['origin_platforms'], ['AutoScout24','mobile.de'])
        empty = clean(item | {'row':item['row'] | {'origin_domains':[], 'origin_platforms':[]}})
        self.assertEqual(empty['origin_domains'], [])
        self.assertNotIn('origin_domains', clean(item))
        for bad in ({'origin_domains':['https://invalid.test']}, {'origin_platforms':['AutoScout24']},
                    {'origin_domains':['mobile.de'], 'origin_platforms':['AutoScout24']},
                    {'origin_domains':'mobile.de'}, {'origin_domains':[None]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                clean(item | {'row':item['row'] | bad})
        with self.assertRaises(ValueError):
            clean(item | {'row': item['row'] | {'source': 'mobile.de'}})

    def test_incomplete_or_malformed_report_rejected_before_connection(self):
        for report in ({'observations':[self.item]}, {'observations':[self.item],'errors':[{'reason':'incomplete'}]},
                       {'errors':[]}, {'observations':[], 'errors':[]}):
            with self.subTest(report=report), patch('reader_pg.psql') as connection:
                with self.assertRaises(ValueError):
                    import_observations('autofindex_trial_unused', report)
                connection.assert_not_called()

    def test_input_conflicts_before_connecting(self):
        changed = self.item | {'row': self.row | {'price': '3.00'}}
        with patch('reader_pg.psql') as connection:
            with self.assertRaisesRegex(ValueError, 'different fields'):
                import_observations('autofindex_trial_unused', [self.item, changed])
            connection.assert_not_called()

    def test_trial_rejects_foreign_database_and_remote_host(self):
        with self.assertRaisesRegex(ValueError, 'trial_'):
            psql('catalogue', '')
        with patch.dict('os.environ', {'PGHOSTADDR': '192.0.2.1'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'local PostgreSQL'):
                psql('autofindex_trial_unused', '')


if __name__ == '__main__':
    unittest.main()
