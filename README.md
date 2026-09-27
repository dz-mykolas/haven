# Haven

A calmer home for your money and everyday plans. First slice: **Money** and **Tasks**, built with Astro + React, a separate Go API, and PostgreSQL.

Money supports EUR accounts/opening balances, income, expenses, transfers, editing, removal/undo, three broad default categories (Recurring, Everyday, Occasional), customizable categories, purpose tags, personal notes, account/category/tag/search/month filters, and exact totals. Tasks supports appointments, one-off tasks, daily/weekly/monthly/yearly recurrence, and payment reminders. Tasks keeps a grouped task list and compact month calendar together on desktop, stacking them on mobile with an expandable week/month navigator. Selecting a date filters the agenda, alongside Upcoming, Today, and Done filters, recurring previews, completed occurrence history, and motion that respects reduced-motion settings. Timezone defaults to the device and stays with each task. Payment completion never records spending. Light, dark, and system themes are included. Money opens with a compact balance summary and recent activity. The wallet icon opens account and bank management; search and account filters are available from the activity filter button.

The assistant has the first navigation position and optional chat through a configurable OpenAI-compatible endpoint. **Live bank connections, push notifications, offline sync, and meeting invitations are not implemented.** Enable Banking sandbox connection/refresh/disconnect is prepared; it requires your EB sandbox application. Booked EUR bank transactions now sync into the main Money view with duplicate prevention and conservative transfer matching. Sandbox accounts are labeled and included in displayed totals; imported financial details are read-only, while categories, tags, and personal notes can be edited and survive refreshes. See [sandbox setup](docs/enable-banking.md). This is a local development build without authentication; do not expose it publicly.

## Run

Recommended: install Docker with Compose and the VS Code Dev Containers extension, then choose **Dev Containers: Rebuild and Reopen in Container**. The workspace installs its tools and dependencies, starts PostgreSQL automatically, and creates isolated test databases. Run `make dev` once setup finishes. See [devcontainer setup](docs/development.md), including how to retain your current database.

For a host installation, requires Node 24 LTS, Go 1.27+, PostgreSQL 17+, and Make. The combined dev script targets Linux (Bash and setsid); other systems can run the API and web in separate terminals.

1. Copy .env.example to .env and choose your own database password/URL. The env file uses shell syntax; quote values if necessary.
2. Start PostgreSQL: use your existing installation, or run `make db` with Docker Compose. Docker is optional.
3. Run `make install`, then `make dev`.
4. Open http://127.0.0.1:4321. The API listens on 127.0.0.1:8080. Empty databases are initialized on API startup.

Separate processes: `make api` and `make web`. For a built frontend, `make build`, start the API, then `npm run preview --workspace apps/web`. Preview uses port 4321 by configuration. Production static hosting must proxy /api to the Go service; the development proxy is not deployed with static assets.

If Astro detects an AI coding agent, it can start a background server. The combined development and test scripts force foreground mode so lifecycle/cleanup remain predictable. Stop a separately launched background instance with `npm exec --workspace apps/web -- astro dev stop`.

## Commands and checks

- `make db`: start the host Compose database, or verify the automatically managed database inside the devcontainer.
- `make check`: Astro/TypeScript checks and Go vet.
- `make test`: Go domain tests with the race detector. Database integration tests skip unless HAVEN_TEST_DATABASE_URL is set.
- `make test-integration`: requires a **disposable PostgreSQL database ending in \_test**; clears its Haven tables. Set HAVEN_TEST_DATABASE_URL first.
- `make test-e2e`: real browser → Go → PostgreSQL workflows, plus automated accessibility checks. Run `npx playwright install --with-deps chromium` once. Set HAVEN_E2E_DATABASE_URL to a **disposable database ending in \_e2e**; the script recreates its public schema. Tests use ports 4322/8181.
- `make build`: static frontend in apps/web/dist and API executable apps/api/haven.
- `make fixtures`: regenerate the [six-month, two-account mock history](docs/mock-data.md); this writes files only.
- `make generate`: regenerate TypeScript types from api/openapi.json.
- `make format`: Go and frontend formatting.

Tests cover exact cents, transfer treatment, edit/delete/undo, database reopening, stale versions, create/completion retries, monthly anchors, device timezone defaults, light/dark/mobile layouts, and core browser workflows. Automated accessibility checks do not replace user testing.

## Back up and restore

The download icon exports all accounts, transactions (including deleted records), tasks, and completion history as versioned JSON. JSON import is not implemented yet.

For a restorable database backup, install the PostgreSQL client tools and run `make backup`. This writes a private custom-format dump under ignored backups/. Keep another copy outside this machine.

Restore into a **new, empty** database (not your current workspace):

```sh
createdb haven_restored
pg_restore --no-owner --no-privileges --dbname=postgres:///haven_restored backups/haven-TIMESTAMP.dump
```

Use connection/role options matching your PostgreSQL installation. Point DATABASE_URL at the restored database, restart the API, and verify balances/tasks before using it. The application never runs an automatic destructive restore.

## Structure

- apps/web — Astro shell, React screens, semantic light/dark CSS tokens, generated API types.
- apps/api/internal/domain — money/date validation, exact summaries, recurrence.
- apps/api/internal/store — transactional operations, PostgreSQL schema, consistent exports.
- apps/api/internal/httpapi — HTTP boundary and browser-origin checks.
- api/openapi.json — reviewable HTTP contract.
- docs/decisions.md — scope, design/architecture research, and remaining work.

Origin checks are not authentication. The API deliberately binds only to loopback. This slice is one personal workspace; hosting and multiple users require real access control first. Financial data stays in PostgreSQL; localStorage holds only theme and sidebar preferences.

Haven's own license remains undecided. No source from Actual or Vikunja was copied.

Open **Haven → Assistant preferences → Set up** to enter an OpenAI-compatible base URL, model ID and optional API key. Chat Completions is the default; Responses is an advanced option. Save **When I ask** to enable chat and connection tests. The assistant asks questions and proposes task or transaction-annotation drafts that you review in existing editors before saving. Keys stay encrypted on the backend; manual mode remains the default. Saved task cost estimates (exact or ranges) and recurring payment reminders appear in Money’s Upcoming section for the next 30 days. Enable **Suggest too** to categorize existing and new transactions automatically. **Assistant → Inbox → History** records these changes and offers undo while the transaction remains unedited. Only new recurring schedules need approval in **To review**; historical entries are processed gradually and new arrivals take priority. The model uses bounded payment history to suggest categories, purpose tags and recurring payment schedules, with a short explanation. Selecting Recurring manually opens the same schedule fields. Saving annotations and their payment task is atomic; both paths show the saved schedule in Tasks and Upcoming. Existing tags and notes are preserved. Automatic transaction matching remains future work. See [setup, credentials and current scope](docs/assistant.md).
