# Draft support request — Jina Reader page-9 diagnostic

To: support@jina.ai (official GitHub organisation contact: https://github.com/jina-ai)

Subject: Reader HTTP 200 returns short non-listing response mentioning captcha

Hello Jina Reader team,

We are evaluating the reliability of Reader for an automotive search prototype, subject to the source site's access conditions.

On 24 November 2026 at approximately 06:32 and 06:38 UTC, two isolated GET requests through Reader to the public URL
https://www.leboncoin.fr/recherche?category=2&page=9
both returned HTTP 200, with a response of 278 characters containing one occurrence of the word "captcha". The responses had the same SHA-256 hash:

22a8bbe2752e35e3faf2492e00f877aecaeba7b8713ac00fa8322fe0fcd97597

The text conversion did not contain detectable vehicle cards, vehicle links, an HTML form or an iframe. We did not retain the raw body. We stopped on the protection signal and have not continued the acquisition campaign.

Could you clarify whether this is an origin-site protection response, a Reader-side error/notification, or another documented response type? Is there an official status/error field to distinguish a successful Reader response from an upstream refusal? Please also let us know the supported, authorized integration options for such sources.

We are not asking for a way to bypass access controls.

Thank you.

## Handoff

Draft only, not sent. No customer or seller information, API credentials or private repository access included. Contact obtained from the verified official Jina AI GitHub organisation; the user can review and send the draft.
