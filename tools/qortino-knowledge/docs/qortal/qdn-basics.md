# QDN Basics

## What QDN is

QDN (Qortal Data Network) is Qortal's decentralized data layer. Every piece of
published data is a *resource* identified by three things: a registered **name**,
a **service** type (e.g. WEBSITE, APP, DOCUMENT, FILE), and an optional
**identifier** string. Data is stored and served by nodes that follow the name.

## Publishing a resource

To publish, an account must own a registered name. Publishing costs a fee in
QORT proportional to data size. Common pitfalls:

- Publishing without a registered name fails — register the name first.
- Identifiers are case-sensitive; keep a consistent naming scheme.
- Large files should be chunked or published as FILE service, not DOCUMENT.

### Example

Publish a JSON document from a Q-App:

```js
await qortalRequest({
  action: "PUBLISH_QDN_RESOURCE",
  name: "Qortino",
  service: "DOCUMENT",
  identifier: "qortino_agent_manifest",
  data64: btoa(JSON.stringify(manifest)),
});
```

## Fetching a resource

Q-Apps fetch with `FETCH_QDN_RESOURCE`, specifying name, service, and
identifier. If the resource is not yet locally available the node downloads it
from peers following that name.

## Service types

Every QDN resource declares a service that sets validation rules and size
limits. Common public services: WEBSITE and APP (multi-file, APP max 50 MB),
FILE and FILES, IMAGE (10 MB), THUMBNAIL (500 KB), VIDEO, AUDIO, DOCUMENT,
JSON (25 KB), BLOG and BLOG_COMMENT, LIST, CODE, GAME, NFT, MAIL (1 MB),
MESSAGE, COMMENT, and CHAIN_COMMENT (239 bytes, fully on-chain). Private
variants (e.g. MAIL_PRIVATE, IMAGE_PRIVATE) store data encrypted so only the
recipient's private key can decrypt it. Resources under 240 bytes can live
fully on-chain; larger payloads are stored off-chain and verified by an
on-chain SHA-256 hash.

## Default resources and shared identifiers

A resource published without an identifier is the "default" for that
name+service — a user's main website is the default WEBSITE for their name.
Apps can use the keyword "default" to address it explicitly. Shared
identifiers create deterministic locations across names: every avatar is
published as service THUMBNAIL with identifier "qortal_avatar", so any app can
fetch any user's avatar knowing only their name.

## App data conventions

Apps should prefix their identifiers with the app name (e.g. "myapp_" +
random suffix) and later search with SEARCH_QDN_RESOURCES using the prefix
option. QDN is permissionless, so an app must validate the format of anything
it fetches rather than trust that its own app published it.

## Updating

Publishing again with the same name + service + identifier overwrites the
resource. Only the current owner of the name can update. If a name is sold,
update rights move with it.
