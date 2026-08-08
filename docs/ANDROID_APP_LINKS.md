# Android App Links — Qortal gateway https links

Qortal GO registers the Qortal QDN **gateway hosts** as Android *App Links* so
that it:

1. appears in the system **Settings → Apps → Qortal GO → Open by default →
   "Opening links"** list (alongside `qortal://` and `qort:` custom-scheme
   links), and
2. can **auto-open** verified `https://` gateway links once each domain hosts a
   Digital Asset Links file for the app's signing certificate.

## What happens when a gateway link is opened

Any `http(s)` URL on a recognized gateway host is translated to the equivalent
`qortal://` deep link and routed through the **exact same** in-app pipeline used
for native links (`src/utils/paymentLink.ts` → `gatewayHttpsToQortalLink()` →
`parsePaymentTarget()` → `handleQortalDeepLink()`):

```
https://qortal.link/WEBSITE/REON            ->  qortal://WEBSITE/REON            (opens in the apps view)
https://qortal.link/APP/Q-Tube/...          ->  qortal://APP/Q-Tube/...          (opens in the apps view)
https://hub.qortal.link/pay?recipient=Q..&amount=5  ->  qortal://pay?...         (opens the Send screen)
```

Rule: **drop the scheme + gateway host, keep the remaining path + query + hash,
prepend `qortal://`.** Hosts are matched case-insensitively, a leading `www.` is
ignored, and any `*.qortal.link` subdomain is treated as part of the gateway
family.

## Registered hosts

Declared in `android/app/src/main/AndroidManifest.xml` (VIEW / BROWSABLE intent
filters, `android:autoVerify="true"` for https):

- `qortal.link`, `www.qortal.link`
- `hub.qortal.link`
- `go.qortal.link`
- `ext-node.qortal.link`

`*.qortal.org` hosts are intentionally **not** registered: they are API/core
nodes whose paths are REST endpoints (not `SERVICE/name` render paths), so
rewriting them to `qortal://` would mis-route. Add a specific `qortal.org`
gateway host to both the manifest and `GATEWAY_HOSTS` in `paymentLink.ts` if one
is ever stood up.

## To make links auto-open (domain verification)

App Links auto-open only after Android verifies the app owns the domain. Each
gateway domain owner must serve this file (see `docs/assetlinks.json`) at:

```
https://<host>/.well-known/assetlinks.json
```

with `Content-Type: application/json` and reachable over plain HTTPS (no
redirects, HTTP 200).

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.github.Qortal.qortalGo2",
      "sha256_cert_fingerprints": [
        "DE:8E:72:35:7E:98:D2:55:5F:84:B6:D0:C9:4C:49:0B:CC:92:44:2A:32:29:02:F8:4A:AB:9E:54:D6:80:B7:E4"
      ]
    }
  }
]
```

> **Important:** the SHA-256 above is the **debug** signing certificate. The
> published/release APK is signed with a different key, so the release fingerprint
> must be added to `sha256_cert_fingerprints` (you can list multiple). Get it with:
>
> ```bash
> keytool -list -v -keystore <release.keystore> -alias <alias> | grep SHA256
> ```

Until each domain hosts a matching `assetlinks.json`, the app still appears in
"Opening links" and the user can enable it manually (verified auto-open is the
only part that needs the domain file).
