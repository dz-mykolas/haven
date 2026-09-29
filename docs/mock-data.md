# Mock accounts

Upload these two files once each using **Upload accounts data** in Enable Banking’s mock control panel:

- [SEB](../tests/fixtures/enable-banking/seb.json): salary, rent, utilities and transfers; 91 transactions.
- [Revolut](../tests/fixtures/enable-banking/revolut.json): daily spending, subscriptions and travel; 279 transactions.

Each file contains **one account, its balance, and its full history**. Both belong to one fictional person in Vilnius, covering **1 March–22 September 2026**.

The history includes Netflix, Discord Nitro, Spotify, iCloud+, Gym+, an annual Bitwarden renewal, variable groceries, refunds, travel and occasional larger purchases. All amounts are fictional. Transfers between the accounts match and do not count as income or spending. Closing balances are **€7,349.36** for SEB and **€875.33** for Revolut.

If your EB mock profile still contains the earlier short sample accounts, replace those synthetic accounts before uploading these, then select the two new accounts during consent. Haven retains previously imported history; replacing accounts in EB does not erase it from Haven.

These files have been validated locally, but have not been uploaded into your EB account for you. After connecting, use Money’s month selector to explore the history. Categories, tags and personal notes can be added in Haven.

Run `make fixtures` to regenerate the files; it does not change the database or EB. Internal test data lives under `tests/fixtures` and is not for upload.
