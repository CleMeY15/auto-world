import unittest

from leparking_page import ad_link, parse_page

PAGE = "https://www.leparking.fr/voiture-occasion/renault-clio.html"
DIRECT = "/voiture-occasion-detail/renault-clio/clio-occasion/"
ID = "ABC12345"
OTHER = "ZYX54321"
LINK = DIRECT + ID + ".html"
LINK2 = DIRECT + OTHER + ".html"


def block(link=LINK, title="Renault Clio", price="8 100 €", mileage="250 530 Km", year="2015"):
    return f"""*   ## {title}

{price}

[Détail]({link})

    *   {mileage}
    *   {year}
"""


class ParkingTests(unittest.TestCase):
    def test_canonical_absolute_query_and_repeated_attributes(self):
        p = parse_page(block(LINK+"?utm_source=x#detail")+"\n* 250 530 Km\n* 2015\n", PAGE)
        r = p['cards'][0]
        self.assertEqual((r['source_id'], r['key'], r['url_kind']), (ID, 'leparking:'+ID, 'detail'))
        self.assertEqual(r['url'], "https://www.leparking.fr"+LINK)
        self.assertEqual((r['price_eur'], r['year'], r['mileage_km']), (8100,2015,250530))
        self.assertEqual(p['complete'], 1)

    def test_detail_tracking_route_identified_without_redirection(self):
        p = parse_page(block(f"/tools/{ID}/0/D/P.html"))
        r = p['cards'][0]
        self.assertEqual((r['source_id'], r['url_kind'], r['url']), (ID, 'redirect',f"https://www.leparking.fr/tools/{ID}/0/D/P.html"))

    def test_missing_heading_uses_linked_photo_caption_in_own_card(self):
        photo = f"*   \nProfessionnel\n[![Image 5: Clio 3](https://img.leparking.fr/photo.jpg)]({LINK2})\n* 123 Km\n* 2020"
        p = parse_page(block() + photo)
        self.assertEqual(len(p['cards']), 2)
        r = p['cards'][1]
        self.assertEqual((r['title'], r['title_source'], r['price_eur'],r['year']),('Clio 3','image_alt',None,2020))

    def test_missing_details_link_but_linked_photo_has_id(self):
        txt = f"*   ## Renault Clio\n[![Image 9: version](https://img.leparking.fr/photo.jpg)]({LINK})\n* 10 Km\n* 2011"
        self.assertEqual(parse_page(txt)['cards'][0]['source_id'], ID)

    def test_currency_whitespace_and_old_and_monthly_amounts(self):
        for separator in (' ', '\u00a0', '\u202f'):
            with self.subTest(separator=separator):
                prices = f"_prix initial :_ ~~10{separator}500 €~~\n9{separator}000 €\nÀ partir de\n156 €\n/ mois\nDès 149 €/mois"
                self.assertEqual(parse_page(block(price=prices))['cards'][0]['price_eur'], 9000)

    def test_old_price_and_monthly_without_current_price(self):
        prices = "Prix initial :\n11 000 €\nA partir de\n158 €\n/ mois\n180 € par mois"
        self.assertIsNone(parse_page(block(price=prices))['cards'][0]['price_eur'])

    def test_footer_offer_and_neighbor_do_not_fill_price(self):
        p = parse_page(block()+block(LINK2,price="")+"\nQue devons-nous faire avec cette annonce ?\n9 000 €")
        self.assertIsNone(p['cards'][-1]['price_eur'])

    def test_repeated_id_full_after_compatible_partial_not_combined_artificially(self):
        p = parse_page(block(price='')+block(f"/tools/{ID}/0/D/P.html"))
        self.assertEqual((len(p['cards']),p['observations'],p['duplicates'],p['complete']), (1,2,1,1))
        p = parse_page(block(price='')+block(year=''))
        self.assertEqual(p['complete'], 0)

    def test_repeated_id_conflict_excluded_even_after_partial(self):
        p = parse_page(block(price="")+block(year="2016")+block())
        self.assertEqual(p['cards'], [])
        self.assertEqual(p['conflict_ids'], [ID])
        self.assertEqual(p['complete'],0)

    def test_ambiguous_fields_and_links(self):
        p = parse_page(block(price="8 100 €\n8 950 €"))
        self.assertEqual((p["cards"],p["conflict_ids"]),([],[ID]))
        p = parse_page(block()+f"\n[Détail]({LINK2})")
        self.assertEqual((p["cards"],p["ambiguous_cards"]),([],1))

    def test_navigation_unknown_genuine_zero_and_interstitial(self):
        for text, status in [
            ("# Recherche\nAucun résultat", "empty_results"),
            ("# Recherche\n[Mes favoris](https://www.leparking.fr/)", "unrecognized"),
            ("Verify that you are human", "verification_signal"),
            ("", "unrecognized"),
        ]:
            self.assertEqual(parse_page(text)['status'], status)
        self.assertEqual(parse_page(block()+"\ntexte captcha")['status'], "results")

    def test_external_lookalike_search_and_invalid_route_do_not_create_ids(self):
        for href in [f"https://leparking.fr.example{LINK}",f"https://leparking.fr@other.fr{LINK}",
                     f"https://account@www.leparking.fr{LINK}",f"javascript:{LINK}",
                     "/voiture-occasion/renault-clio.html",f"/tools/{ID}/bad/path"]:
            self.assertIsNone(ad_link(href, PAGE))

    def test_pandoc_linked_heading_no_bullets(self):
        p = parse_page(f"## [Renault Clio]({LINK})\n5 000 €\n- 25 000 Km\n- 2010")
        self.assertEqual((p['complete'],p['cards'][0]['title']), (1,'Renault Clio'))


    def test_conflicting_partial_evidence_persists_and_ids_quarantined(self):
        a = block(price="7 800 €", year='')
        b = block(price="8 100 €",year="")
        p = parse_page(a+b)
        self.assertEqual(p["observed_values"][ID]["price_eur"], [7800,8100])
        self.assertEqual(p["observed_values"][ID]["mileage_km"], [250530])
        self.assertEqual(p["cards"], [])
        ambiguous = block()+f"[Détail]({LINK2})\n"
        p = parse_page(ambiguous+block())
        self.assertEqual(set(p["conflict_ids"]), {ID,OTHER})
        self.assertEqual(p["cards"], [])

    def test_compatible_partial_evidence_separate_from_one_observation(self):
        p = parse_page(block(price="")+block(year=""))
        self.assertEqual(p["observed_values"][ID],
                         {"title": ["Renault Clio"], "title_image_alt": [],
                          "price_eur":[8100], "year":[2015], "mileage_km":[250530]})
        self.assertFalse(p["cards"][0]["complete"])

    def test_photo_only_tracking_is_not_a_publication_card(self):
        path = f"/tools/{ID}/0/P/PL.html"
        self.assertEqual(parse_page(block(path))["cards"], [])
        for url in [f"/tools/{ID}/7/D/P.html",f"/tools/{ID}/0/L/P.html",
                    f"/tools/{ID}/0/T/ABC.html",DIRECT+"Ab3456EF.html",
                    DIRECT+"ABC.html",DIRECT+"0123456789ABC.html"]:
            self.assertIsNone(ad_link(url, PAGE))

    def test_postal_code_and_pathological_numbers_are_ignored(self):
        p = parse_page(block(year="")+ "\n* MANUELLE\n* 2000")
        self.assertIsNone(p["cards"][0]["year"])
        p = parse_page(block(price="9"*5000+" €",mileage="7"*5000+" Km",year="Année : 2018"))
        self.assertEqual((p["cards"][0]["price_eur"],p["cards"][0]["mileage_km"],p["cards"][0]["year"]), (None,None,2018))

    def test_formatted_footer_and_weak_mentions(self):
        for footer in ["**Que devons-nous faire avec cette annonce ?**", "* **Que devons-nous faire avec cette annonce ?**",
                       "### **Que devons-nous faire avec cette annonce ?**"]:
            p = parse_page(block(price="")+footer+"\n9 000 €")
            self.assertIsNone(p['cards'][0]['price_eur'])
        self.assertEqual(parse_page("Ce texte dit CAPTCHA.")["status"], "verification_mention")

    def test_fallback_title_evidence_is_distinct_from_heading(self):
        alt = f"*   \nParticulier\n[![Image 5: version détaillée](https://img.leparking.fr/photo.jpg)]({LINK})\n* 250 530 Km\n* 2015\n"
        p = parse_page(alt+block())
        self.assertEqual(p["observed_values"][ID]["title"], ["Renault Clio"])
        self.assertEqual(p["observed_values"][ID]["title_image_alt"], ["version détaillée"])
        self.assertEqual(p["conflict_ids"], [])


if __name__ == "__main__":
    unittest.main()
