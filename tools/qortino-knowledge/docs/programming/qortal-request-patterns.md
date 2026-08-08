# qortalRequest Patterns

## Getting the logged-in account

```js
const account = await qortalRequest({ action: "GET_USER_ACCOUNT" });
// { address, publicKey }
```

## Fetching a name's resources

```js
const res = await qortalRequest({
  action: "LIST_QDN_RESOURCES",
  name: "Qortino",
  service: "FILE",
  limit: 20,
});
```

Common pitfall: some actions require user approval popups; batch reads where
possible to avoid popup fatigue.

## qortalRequest action map

Read-only (no approval): GET_ACCOUNT_DATA, GET_ACCOUNT_NAMES, GET_NAME_DATA,
GET_BALANCE, FETCH_QDN_RESOURCE, LIST_QDN_RESOURCES, SEARCH_QDN_RESOURCES,
GET_QDN_RESOURCE_STATUS / METADATA / PROPERTIES / URL, SEARCH_NAMES,
SEARCH_TRANSACTIONS, FETCH_BLOCK, FETCH_BLOCK_RANGE, GET_AT, GET_AT_DATA,
LIST_ATS, LIST_GROUPS, GET_PRICE, GET_DAY_SUMMARY.

Require user approval (show a popup): GET_USER_ACCOUNT, GET_USER_WALLET,
GET_USER_WALLET_INFO, GET_WALLET_BALANCE, PUBLISH_QDN_RESOURCE,
PUBLISH_MULTIPLE_QDN_RESOURCES, SEND_COIN, SEND_CHAT_MESSAGE (group),
JOIN_GROUP, DEPLOY_AT, CREATE_POLL, VOTE_ON_POLL, SAVE_FILE, list actions
(GET/ADD/DELETE_LIST_ITEMS), GET_FRIENDS_LIST, SET_PROFILE_DATA,
SEARCH_CHAT_MESSAGES.

Navigation/UI: OPEN_NEW_TAB (qortal:// link), OPEN_PROFILE, notifications.

## Key gotchas

- Publishing from a Q-App supports single files or base64 only; multi-file
  WEBSITE/APP publishing is not available via qortalRequest yet.
- Amounts: QORT values from GET_PRICE and transactions are integers scaled by
  1e8 — divide to get QORT.
- Encrypt with ENCRYPT_DATA (pass publicKeys array for group encryption);
  DECRYPT_DATA needs the counterparty public key and base64 input.
- Use qortalRequest's built-in timeouts; qortalRequestWithTimeout exists but
  letting the core manage timeouts is more futureproof.
- Direct REST fetch() works for anonymous reads (e.g. /names/{name}) but
  cannot identify the logged-in user — use qortalRequest for anything
  personalized.
- Batch reads to avoid approval-popup fatigue; group approval-needing calls
  behind explicit user actions.
