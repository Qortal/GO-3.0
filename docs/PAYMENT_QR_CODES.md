# Qortal GO — Payment QR codes & deep links (developer guide)

This guide is for anyone building a website, payment gateway, invoice, or point-of-sale
screen that wants a QR code (or link) which opens **Qortal GO** on Android and pre-fills a
QORT payment for the user to approve.

## TL;DR — the recommended format

Encode this URI in your QR code (or use it as a normal `<a href>` link):

```
qortal://pay?recipient=<QORTAL_ADDRESS_OR_NAME>&amount=<QORT_AMOUNT>
```

Example:

```
qortal://pay?recipient=QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH&amount=5
```

When a user scans this with any QR scanner (or taps the link), Android offers to open
**Qortal GO**. GO opens the **Send QORT** screen pre-filled with the recipient and amount.
The user only enters their wallet password and taps **Send** — no copy/paste, no typos.

> The user always confirms the payment with their password. A link can never move funds
> on its own; it only pre-fills the form.

## Supported formats

Qortal GO understands all of the following. Use the first one for new integrations.

| Format | Example | Notes |
| --- | --- | --- |
| `qortal://pay` (recommended) | `qortal://pay?recipient=Q...&amount=5` | Recipient may be an address **or** a registered Qortal name. |
| `qortal://send` (alias) | `qortal://send?to=Q...&amount=5` | Same as `pay`. |
| `qort:` (BIP21-style) | `qort:QUxbm...?amount=5` | Recipient must be a raw address. |
| `qortal://<address>` | `qortal://QUxbm...?amount=5` | Bare address after the scheme. |
| Bare address | `QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH` | Works only via GO's **in-app scanner** (see below). |

### Parameter names

- **Recipient**: `recipient`, `to`, `address`, or `r`
- **Amount** (in QORT): `amount`, `qty`, `qort`, or `value`

Amount is optional. If you omit it, GO opens the Send screen with the recipient filled in
and lets the user type the amount.

## Important: bare-address QR codes

A QR code that contains **only** the raw address (for example
`QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH`) is just plain text. Android has no way to know it
belongs to Qortal GO, so an external scanner will say something like *"Can't open an app
for this QR code."* This is a limitation of every wallet, not just Qortal GO.

Two ways to handle it:

1. **Best:** change your QR to the `qortal://pay?...` form above. Then any scanner can open
   GO directly, and you can include the amount.
2. GO also has a **built-in scanner**: open GO → **Send QORT** → tap the QR icon in the
   *To* field. That scanner reads bare-address QR codes (and all the formats above), so your
   existing address-only QR still works for GO users who scan from inside the app.

## How to generate the QR code

Any QR library works — just encode the URI string. Examples:

HTML (using a public QR image service, or your own generator):

```html
<a href="qortal://pay?recipient=QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH&amount=5">
  Pay 5 QORT with Qortal GO
</a>
```

JavaScript (e.g. with the `qrcode` npm package):

```js
import QRCode from 'qrcode';

const address = 'QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH';
const amount = 5;
const uri = `qortal://pay?recipient=${encodeURIComponent(address)}&amount=${amount}`;

const dataUrl = await QRCode.toDataURL(uri); // <img src={dataUrl} />
```

Python (`qrcode` package):

```python
import qrcode

address = "QUxbmMbck1aZV1jQEuVFnMHpYxHiL7nrGH"
amount = 5
uri = f"qortal://pay?recipient={address}&amount={amount}"
qrcode.make(uri).save("pay.png")
```

## Notes & good practices

- **Always URL-encode** values you interpolate, especially registered names that may contain
  spaces (`My%20Shop`).
- Amounts are plain QORT (e.g. `5`, `0.25`). Use a `.` decimal separator.
- The link/QR pre-fills the form only; the user reviews and confirms with their password.
- On desktop (Qortal Hub) the same `qortal://pay?...` links work when clicked inside the Hub.
- If you run a payment gateway that watches an address for incoming funds, keep doing that —
  the deep link is purely a convenience for the payer and does not change how you detect
  confirmations on-chain.

## For AI assistants

Paste this prompt into an AI to have it generate a correct integration:

> Generate a Qortal GO payment QR code / link. Qortal GO registers the `qortal://` (and
> `qort:`) URI scheme on Android. The canonical payment URI is
> `qortal://pay?recipient=<ADDRESS_OR_NAME>&amount=<QORT_AMOUNT>`. Recipient param aliases:
> `recipient|to|address|r`. Amount param aliases (QORT, decimal with `.`):
> `amount|qty|qort|value`; amount is optional. Recipient may be a raw Qortal address or a
> registered name. Also valid: `qortal://send?to=...`, `qort:<address>?amount=...`,
> `qortal://<address>?amount=...`. Produce: (1) the URI string, (2) a QR code image encoding
> that exact string, and (3) an HTML anchor using the URI as href. URL-encode all
> interpolated values. Do NOT invent extra parameters. Note that the link only pre-fills the
> Send screen; the user approves the payment with their wallet password.
