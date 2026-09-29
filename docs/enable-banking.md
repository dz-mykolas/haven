# Enable Banking sandbox setup

This slice connects Haven to **Enable Banking's actual sandbox API**. It uses the official Mock ASPSP or another available Lithuanian personal-account sandbox. It does not simulate a successful EB connection when credentials are absent. Booked EUR accounts and transactions sync into Money’s main accounts, transaction list, totals, and JSON export. They remain clearly marked as sandbox data. The bank connection panel retains the raw snapshot, including pending payments.

## What the research established

- [EB's sandbox guide](https://enablebanking.com/docs/api/sandbox/) recommends its controllable Mock ASPSP for realistic flow testing; individual bank sandboxes may be unreliable or incomplete. Mock ASPSP needs no bank login credentials and can use accounts/transactions configured in the EB control panel. Its transaction endpoint paginates in batches of ten; payment initiation is not supported.
- The [API reference](https://enablebanking.com/docs/api/reference/) uses one API host, `https://api.enablebanking.com`, for both environments. The registered **application** determines sandbox vs production. Haven checks `/application` for `SANDBOX`, activation, and the registered callback before starting authorization or reading data.
- The flow is banks → `/auth` → browser consent → callback `code`/`state` → `/sessions` → balances/transactions. The Go server signs short-lived RS256 JWTs; no private keys or session IDs reach browser JavaScript.
- Account `uid` is session-scoped. `identification_hash` is the useful cross-session account identity; transaction `entry_reference` is scoped to the account. The separate `transaction_id` is not a stable deduplication identifier. The importer uses those stable identifiers, with independent Haven UUIDs.
- Sandbox and production are separate application registrations, not an environment switch on one application. Mock SEB/Revolut labels below are scenario names, not evidence that either real bank has been connected or its particular authentication behavior tested.

## One-time registration

1. Sign in to the [Enable Banking control panel](https://enablebanking.com/sign-in/), then register an API application with environment **Sandbox**. See the [official quick start](https://enablebanking.com/docs/api/quick-start/).
2. Choose browser-generated private-key export. Save the downloaded PEM securely on the machine running Haven's Go API; copy the application ID.
3. Register this exact redirect URL:

   ```text
   http://127.0.0.1:4321/api/banking/callback
   ```

4. In **Mock ASPSPs**, configure a Lithuanian mock bank for personal accounts. Use **Upload accounts data** to upload [seb.json](../tests/fixtures/enable-banking/seb.json), then [revolut.json](../tests/fixtures/enable-banking/revolut.json). Each file contains one account, its balance, and its transaction history. See [mock data](mock-data.md) for details.
5. Add the following to your ignored `.env`, replacing the ID and absolute key path:

   ```sh
   EB_APPLICATION_ID='your-sandbox-application-id'
   EB_PRIVATE_KEY_PATH='/absolute/path/to/downloaded-private-key.pem'
   EB_REDIRECT_URL='http://127.0.0.1:4321/api/banking/callback'
   ```

   Keep the key file readable only by its owner (`chmod 600 /absolute/path/to/downloaded-private-key.pem`). Do not paste the key into chat or commit it. `.pem` and `.key` files are ignored by Git. Paths refer to the backend filesystem; mount/copy the file into the dev container if it was downloaded on your host.

6. Restart `make dev`. Open **http://127.0.0.1:4321/#money** using that exact hostname. `localhost` and `127.0.0.1` do not share cookies. If working through a forwarded development URL, register its HTTPS `/api/banking/callback`, use that value in `EB_REDIRECT_URL`, and add its exact origin to `HAVEN_ORIGINS`. Keep the forwarded port private; Haven still has no user authentication.
7. Open the **Accounts & banks** panel using the wallet icon next to Add, then **Bank connections → Connect test bank**, select the Mock ASPSP returned by EB. Complete its simulated consent. Haven returns to Money and retrieves the first snapshot automatically. Booked EUR records also appear in the main accounts and transaction list. Expand each connection account for raw balances and pending records. After upgrading an existing connection to this importer, restart `make dev` and refresh the connection once.

Mock names are loaded from EB, not hardcoded as working SEB/Revolut integrations. The selector currently lists Lithuanian banks supporting `personal` users. If your mock does not appear, check its country and personal-account configuration in EB.

### Check the upload

Each account row has a **Balances & Transactions** button. Expect one balance per account, with 91 transactions for SEB and 279 for Revolut. Both files contain booked transactions only. Use **Upload accounts data**, not **Add a new account**, and upload each file once. If an upload fails, check its error response before retrying.

## Test scenarios

The two accounts belong to one fictional person, with salary, everyday expenses, subscriptions, refunds and matching transfers from March through 22 September 2026.

- Connect, approve, and see both mock accounts in Money, labeled Sandbox. Displayed totals include these accounts; the original manual records remain unchanged.
- Refresh twice: snapshot replacement and ledger upserts must not accumulate duplicate transactions.
- Change the mock data in EB, refresh, and see the new snapshot. Booking status and balance type remain visible; pending payments are not silently treated as booked.
- Cancel the consent screen: show cancellation and create no connected record.
- Refresh after expiry: request reconnection. Connecting again creates a separate consent record, but reuses the imported accounts and transactions when their stable identifiers match.
- Disconnect: revoke the EB session, remove its stored session credentials locally, retain its last clearly labeled snapshot and imported history. A failed provider revocation stays an error, not a pretend disconnect. Disconnected connections disappear from the panel.
- Provider failure or pagination failure: retain the last complete snapshot and last successful refresh timestamp.

Local tests use a test-only HTTP transport that emulates EB responses and verifies JWTs, pagination, state/cookie binding, replay/expiry, remote disconnect, persistence, duplicate prevention across reconnects, exact balances, transfer matching, and preservation of manual records. This is **not** a substitute for testing your registered EB sandbox end to end. No embedded fake bank runs in the normal application.

## Money import behavior

- Schema migration 3 adds separate bank account/history tables. A complete refresh atomically saves the snapshot and imports booked EUR records; any page, validation, or database failure keeps previous data intact.
- Account identity is scoped by application, bank, country, environment, and EB identification hash. Transactions are unique by account and entry reference. A reconnect reuses Haven IDs; a provider correction updates the existing record. Older booked history is retained when a bank’s fetch window no longer returns it.
- Only BOOK transactions with a stable entry reference, valid booking date, positive exact-cent EUR amount, and known debit/credit direction enter Money. Pending records stay in connection details. Missing required booked data rejects the import with an error rather than guessing dates or deduplication keys.
- Account totals use bank-reported accounting balances (ITBD, otherwise CLBD; latest date within that type). Available balances are not substituted. Imported history is not added to that balance again. Non-EUR accounts and missing/ambiguous booked balances reject the import.
- Transfers require equal amounts, opposite directions, booking dates within three days, and reciprocal account identity. IBANs take priority; exact unique account labels are a sandbox-only fallback for mocks without IBANs. Both sides must have exactly one candidate. Matching pairs display once, under the outgoing record’s stable ID, and affect neither income nor spending. Ambiguous pairs remain separate income/expense records until a future review workflow.
- Bank financial details are read-only. Categories, tags and personal notes are editable through a separate annotation endpoint; bank refreshes only update source payloads. The original bank description stays separate. Manual APIs reject bank-owned IDs and cannot create manual transactions against imported accounts. Existing manual accounts are not automatically linked or deduplicated against bank history.
- Money’s JSON export now includes the displayed bank accounts and booked transactions, marked by source, without connector credentials. Full database backups also include the underlying source history and active session identifiers; keep them private.

## Remove an account

Open **Accounts & banks**, click the trash icon beside an account, then confirm **Remove account**. This removes it from Money and exports and skips it on ordinary refreshes. To add it back, use **Connect test bank** and select it during the new consent; Haven restores its history and personal labels without duplicates. Removal is local to Haven; it does not close or delete the account in Enable Banking. Transfers involving a remaining account stay in its history and do not become income or spending. Connection cards disappear once all their authorized accounts have been removed, including older connections with no snapshot. Adding an account back does not revive these older connections. New connections awaiting their first sync remain visible. Internally, removed records are retained to preserve those transfers and prevent accidental reimport; this is not a permanent data purge.

## Boundaries and next step

No scheduled polling, automatic categorization, manual/bank reconciliation, multi-currency accounting, production bank access, or payment initiation is implemented. Refresh retrieves and imports a new snapshot on demand; disconnect retains imported history. Production remains a separate future opt-in path.

Refresh is bounded to 20 accounts, 100 pages and 10,000 transactions per account, and a request deadline. Exceeding a limit preserves previous data. Money activity uses a cursor-paginated projected ledger; monthly reads include a six-day margin for transfer matching. Full summaries and review reconciliation still read workspace history.

## Categories, tags and longer mock history

Migration 4 adds the category and tag catalogs and bank annotation columns. Restart the Go API to apply it. Open a transaction → **Category, tags & notes** to organize it. Category management (add, rename, hide/show) is under **Accounts & banks → Categories**. Hidden categories remain visible on assigned transactions and remain filterable. Tags are created while editing a transaction, with existing tags suggested as you type; case and extra spaces do not create duplicates. User notes and the original bank description are independent and both searchable.

The [mock data](mock-data.md) has just two upload files: SEB and Revolut. Categories, tags and notes remain yours to assign in Haven.
