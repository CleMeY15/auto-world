"""Offline false-positive controls with synthetic, fully visible facts."""
import unittest

from optional_notices import optional_public_listing


CANONICAL = '<link rel="canonical" href="https://suchen.mobile.de/fahrzeuge/details.html?id=70701">'
FACTS = ('<main><article><h1>Local Testauto</h1><p>Kaufpreis: 12.300 EUR</p>'
         '<p>Erstzulassung: 03/2020</p><p>Kilometerstand: 43.200 km</p></article></main>')
FORM = ('<form aria-label="Contacter le vendeur"><label>CAPTCHA pour envoyer votre message</label>'
        '<button>Envoyer</button></form>')
NOTE = '<footer><p>Aide : en cas de « Access Denied » dans le formulaire de contact, contactez le vendeur.</p></footer>'
COOKIES = '<footer><button>Accepter les cookies</button><button>Continuer sans accepter</button></footer>'


def page(extra=FORM, facts=FACTS, canonical=CANONICAL):
    return '<html><head><title>Local Testauto</title>'+canonical+'</head><body>'+facts+extra+'</body></html>'


class OptionalNoticesTests(unittest.TestCase):
    def test_explicitly_optional_locations(self):
        for extra in (FORM, NOTE, COOKIES):
            with self.subTest(extra=extra):
                self.assertTrue(optional_public_listing(page(extra)))

    def test_rejects_missing_or_invisible_vehicle_evidence(self):
        for doc in (page(canonical=''), page(canonical=CANONICAL*2), page(facts=FACTS.replace('43.200 km', '')),
                    page(facts='<div style="display: none">'+FACTS+'</div>'), page(facts=FACTS*2),
                    page(facts='<main><h1>Local Testauto</h1></main>')):
            with self.subTest(doc=doc):
                self.assertFalse(optional_public_listing(doc))

    def test_does_not_excuse_page_wide_checks_or_unrelated_form(self):
        for x in (FORM+'<section>Access Denied</section>', FORM+'<dialog open>Continuer</dialog>',
                  FORM+'<div role="alertdialog">Continuer</div>', FORM+'<div inert></div>',
                  FORM.replace('Contacter le vendeur', 'Website login'),
                  FORM.replace('pour envoyer votre message', 'obligatoire'),
                  FORM.replace('pour envoyer votre message', 'pour accéder à la page ou pour envoyer votre message'),
                  FORM+'<div class="verificationOverlay">Continuer</div>',
                  FORM+'<div style="position: fixed; inset: 0">Continuer</div>',
                  FORM.replace('</form>', '<iframe src="/captcha/widget"></iframe></form>'),
                  FORM+'<p>Véhicule indisponible</p>',
                  NOTE.replace('dans le formulaire de contact, contactez le vendeur', 'sur cette page'),
                  FORM.replace('Envoyer</button>', 'Valider</button>'),
                  NOTE.replace('« Access Denied »', 'Access Denied'),
                  FORM+'<iframe src="/challenge-platform/"></iframe>'):
            with self.subTest(x=x):
                self.assertFalse(optional_public_listing(page(x)))

    def test_hidden_or_disabled_rejection_button_is_not_evidence_of_choice(self):
        for button in ('<button disabled>Continuer sans accepter</button>',
                       '<div hidden><button>Continuer sans accepter</button></div>',
                       '<button aria-disabled="true">Continuer sans accepter</button>'):
            with self.subTest(button=button):
                self.assertFalse(optional_public_listing(page('<footer><button>Accepter les cookies</button>'+button+'</footer>')))
