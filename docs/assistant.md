# Assistant skills, model connection and chat

Haven supports an OpenAI-compatible text endpoint behind its Go backend. Chat can
ask clarification questions and propose task drafts or category/tag/note changes
for attached transactions. Chat drafts require Save in the existing editor. In
Suggest too mode, background categorization applies automatically with undo;
new recurring schedules still require approval.

## Connect a model

1. Open **Haven → Assistant preferences → Set up**.
2. Enter the **API base URL** (including its API prefix, usually `/v1`), **model ID**,
   and **API key**. Keyless local endpoints are supported.
3. Save the connection, choose **When I ask**, and save preferences.
4. Reopen preferences and choose **Test connection**, then start chatting.

Chat Completions is the default. **Advanced → API format** also supports Responses
for providers that need it. For example, an OpenAI base URL is
`https://api.openai.com/v1`; a local server might be `http://localhost:1234/v1`.
Use a text/chat model that follows JSON instructions. Haven checks the response
format and validates every draft; incompatible or malformed output produces an
error and no changes. A successful test checks a short text completion, not draft
quality. Provider billing and retention rules apply to requests sent there.

The URL must be reachable from the **Go process**. Inside a devcontainer,
`localhost` is the container, not the host desktop. Use a reachable private IP or
`host.docker.internal` where configured. Remote endpoints require HTTPS; local
and private IP endpoints can use HTTP. Redirects are not followed. Saving a
connection makes no model request. Test sends a short message only after manual
mode is disabled. Changing settings clears the recorded successful test.

Official API references: [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and [Responses and migration](https://developers.openai.com/api/docs/guides/migrate-to-responses).
The adapter uses the common non-streaming text contract, with no provider SDK or
optional structured-output extension required. Responses requests set `store: false`.

## Controls and context

- **Manual only** (default): blocks chat and connection tests. Money and Tasks
  continue to work normally.
- **When I ask**: enabled skills can run for explicit chat requests.
- **Suggest too**: reviews existing and newly arriving uncategorized transactions
  automatically; only new recurring schedules go to the inbox. Requires a model connection and the Review transactions
  skill. New arrivals take priority; history is processed in batches of five.
- Per-skill switches restrict both instructions and available context.
- Each draft is one **clickable preview card** showing its key details. Click
  anywhere on it to open the autofilled editor. Saving uses normal application
  validation/version checks.
- Manual mode retains other preferences. Cancel/Escape/backdrop dismiss unsaved
  preference edits. Connection changes have their own explicit Save action.

A chat request sends its recent conversation, the device timezone/current date, up to
100 active tasks when task planning is enabled, and the transactions the user
attaches. With Review transactions enabled, selected transactions also receive
bounded read-only payment history (see Transaction inbox below). Money skills also
receive existing categories and tag names. Account
balances and the full transaction history are not included. Conversations live
in page memory and clear on navigation/reload or permission/connection changes.
Stop cancels Haven's request; it cannot retract information already sent to a
provider. Requests time out, provider errors are sanitized, and raw responses are
not logged or persisted.

Current drafts support creating/editing a task and editing attached transactions'
category, tags and notes. Financial values from bank imports remain read-only.
Task drafts support optional exact or ranged cost estimates. The cost-question
preference controls whether the assistant proactively asks about them; a user can
always volunteer a cost. Replies should use one short sentence or question, leaving
details to the card and avoiding repeated disclaimers or internal field names.
Automatic transaction matching, reusable categorization rules, custom skill import
and push notifications remain future work.

## Credentials and deployment

API keys are sent once from the settings form to Go, then stored encrypted with
AES-GCM in PostgreSQL. Read APIs return only `has_api_key`; reopening the password
field never reveals the old key. Leave it blank to retain the key, select Remove
saved API key to clear it, or enter a replacement. Changing the endpoint requires
a replacement key or explicitly clearing the old one, preventing accidental key
reuse at a different service.

The encryption key is generated on first save of a nonempty API key. Set
`HAVEN_LLM_KEY_FILE` to a persistent private path if desired. The default is
`.secrets/llm-encryption.key` relative to the backend's working directory
(`apps/api/.secrets/llm-encryption.key` with `make dev`). It is created with file
mode 0600 and excluded from Git. Retain this file separately alongside database
backups, or re-enter the provider API key after restoring a database. JSON exports
include assistant preferences but **exclude the model connection and credentials**.
SQL backups contain the encrypted credentials, not their wrapping key.

This remains a single personal workspace without authentication. Do not publicly
expose it. Before multi-user deployment, scope settings, secrets and context to
authenticated users/workspaces, and add rate/concurrency limits.

## Structure and API

Bundled instruction-only skills live at
`apps/api/internal/assistant/skills/*/SKILL.md`: `review-transaction`, `plan-task`
and `organize-money`. Go embeds them. They cannot create tools, grant permissions
or execute code. Prompt assembly has three responsibilities: `prompts.go` defines generic tone,
clarification and authority rules; enabled skills define domain decisions; and
application-owned output contracts specify the allowed draft shapes. Go validates
those shapes and permissions independently of the skill text. Contracts and
instructions for disabled capabilities are omitted. User preferences are supplied
as structured context. Enabled instructions are combined for one model call;
there is no separate agent framework.

`assistant.Run` checks current policy before context collection and after
completion. Chat hardcodes the `chat` trigger. Results are discarded if the
settings or provider version changed during generation. Typed draft validation
rejects unknown fields, invented IDs, invalid money values, disabled skills and
unselected transactions. Existing IDs carry current record versions into editors.

- `GET /api/assistant`: settings, skill catalog and connection metadata.
- `PUT /api/assistant/settings`: complete preferences with version.
- `PUT /api/assistant/provider`: base URL, model, protocol, version and optional key
  (`null`/omitted retains it, `""` clears it).
- `DELETE /api/assistant/provider`: remove connection and encrypted key with version.
- `POST /api/assistant/provider/test`: test the saved version.
- `POST /api/assistant/chat`: messages, timezone and selected entry IDs; returns a
  message plus optional typed task/entry drafts, without writing business records.

Migrations 6 and 7 add preferences and provider storage; migration 8 adds nullable
task cost bounds; migration 9 adds the persistent review queue; migration 10
adds per-suggestion explanations and simplifies default categories. Restart Go
after updating.
Validation covers both wire formats, cancellation, redirect/key protection,
malformed drafts, real PostgreSQL credential/settings behavior, and the complete
browser setup/chat/review/save flow against a local compatible test server.

The legacy `presentation` field remains accepted in stored settings and exports
for compatibility; the current UI always uses a single clickable preview card.

Task follow-ups carry up to eight validated conversation drafts alongside messages.
Unsaved IDs remain stable across revisions, and only the latest card is actionable.
Saved task drafts must still match the current database revision. User-supplied
appointment estimates use dedicated integer-cent bounds, shown in the preview
and editable as a single amount or range (for example 60–70). Unknown costs are
null; explicit zero is distinguishable. Estimates are included in task exports.

Money shows **Upcoming · next 30 days**, independent of the activity reporting
month. Saved appointments with costs and payment reminders contribute to a
read-only occurrence projection, including recurring subscriptions. Monthly
anchors survive short months, duplicate occurrences are excluded, completed and
deleted tasks are excluded, and totals use exact integer arithmetic. Unknown
payment amounts are listed but excluded from known totals. Completing a reminder
advances/removes its occurrence without creating an expense. Recorded spending
and balances remain ledger-only; bank transactions are not automatically matched
to upcoming reminders yet. Existing payment reminders use their original amount
as an exact estimate. Earlier note-only costs are not silently inferred; edit the
task to set its cost explicitly.

Purchase planning belongs to `plan-task`: a purchase with a usable timeframe and
approximate cost becomes a task draft with estimated cost bounds. A window such
as “in the next two weeks” resolves to an editable target deadline at its end,
not a booking or actual purchase date. Missing optional time does not block a
draft. Subscriptions still need a resolvable first due date and an explicitly
supported recurrence. Skill examples cover these distinctions.

Prompt assembly checks verify that disabled skills/contracts are omitted and
current cost preferences are included. These checks do not prove live-model
compliance; when evaluating a provider, use the hairdryer, dentist, cost follow-up
and subscription examples in the task skill, checking the actual supplied date.

## Transaction inbox

Assistant has **Chat** and **Inbox** views. The background worker automatically
applies supported categories and purpose tags to existing and new transactions.
**To review** contains only proposed recurring schedules, with one decision per
account/merchant arrangement. Its count appears in navigation and Money's inbox
button. **History** includes automatic classifications, saved/dismissed schedules,
unchanged results and stale records; both views load cursor pages automatically while scrolling.

Enable **Suggest too** with **Review transactions** to start. There is no separate
backfill action. Transfers, removed/deleted entries and user-revised transactions
are excluded, except Recurring expenses needing a schedule. Supported tags may
be applied even if the category is uncertain. Existing tags and personal notes
are preserved. Explanations never become personal notes.

Automatic changes store the original annotations and applied revision. **Undo
categorization** in a card's menu restores the pre-AI category and tags only if
that transaction has not subsequently been edited or corrected by the bank.
Undo is durable and prevents automatic reapplication. User saves lock the AI
record, even if they save an unchanged annotation. Amounts, dates, accounts,
bank descriptions and scheduled tasks are never changed by classification undo.

The three default expense categories are **Recurring**, **Everyday**, and
**Occasional**. Recurring covers ongoing scheduled payments, including variable
utility bills and annual subscriptions. Everyday covers normal daily spending,
including repeated supermarket visits. Occasional covers expenses outside the
user's normal routine, such as a laptop, holiday or unexpected repair. Amount
alone does not determine the category, and insufficient evidence can leave it
**Uncategorized**. Income and transfers keep their existing transaction types;
expense categories are not forced onto income.

Purpose and context belong in tags. The initial catalog includes Health, Fitness,
Home, Groceries, Dining, Transport, Travel, Entertainment, Electronics, Salary,
Refund and Interest; user-defined tags and categories remain supported. The
category catalog is seeded directly without legacy category conversion.

Background requests contain at most five editable transactions, the category/tag
catalog, and a read-only sample of past payments. Retrieval includes up to twenty
payments per selected merchant (one hundred total), plus forty recent other
payments to help identify merchant-name variations. Name matching only retrieves
context: the LLM judges whether dates, amounts and descriptions indicate a
recurring arrangement, everyday spending, or an occasional expense. There are no hardcoded recurrence counts,
interval tolerances, or merchant-to-category rules. The prompt identifies
truncated history and asks the model to express uncertainty rather than force a
category. Historical context includes already organized payments, but excludes
deleted records, transfers, personal notes, account balances, tasks and chat
history. It cannot be targeted for edits. These same history boundaries apply to
explicit chat reviews of attached transactions. These requests use the configured
model and may incur
provider charges. **When I ask**, **Manual only**, disabling the review skill or
removing the connection pauses new processing. Already generated suggestions
remain available for manual review.

Draft cards summarize the merchant, amount and proposed category; optional tags
and the next payment date are secondary. Click the card to review. The model's
explanation is inside **Why this suggestion**; **Dismiss** is in the card's
more-options menu.

**Review** opens the existing editor with the proposed schedule and the already-applied category/tags. Opening or
cancelling leaves the item pending. **Save** validates the current transaction
facts and version, saves its annotations and optional payment schedule, and
resolves the item atomically.
**Dismiss** declines the schedule; the already-applied categorization stays saved and can be undone separately. Normal
transaction edits also resolve any pending review. Handled items are not
regenerated on refresh or restart. Transactions changed during generation or
before saving cannot be overwritten by an old suggestion.

Selecting **Recurring** shows **Future payments** directly below the category.
Bank transactions and inbox reviews show recorded facts in a compact summary;
tags, notes and the model's explanation expand separately. The header and save
action stay outside the scrolling content, with an overlay scrollbar that does
not change the content width.
Manual entry, LLM chat drafts and inbox reviews share the same fields and save
operation: next expected date, frequency and expected cost (exact or range).
Manual dates/frequency start empty; an LLM may prefill them from supported history.
Complete schedules start as a compact amount, frequency and next-date summary.
**Edit** reveals the fields and linking options; missing dates or frequencies
keep the fields expanded. Collapsing preserves edits and includes them when saving.
Fixed schedules need a next date and frequency. Expected and prepaid plans may retain unknown timing. Existing plans show **Linked** and remain linked;
schedule linking options are available in the expandable schedule section.
Daily, weekly, monthly and yearly schedules are supported. Fixed schedules appear in Tasks; expected/prepaid plans appear there only when their reminder switch is enabled. Upcoming shows plans relevant to the next 30 days.
It never creates another expense or changes the imported transaction's amount.

Accepted schedules are linked by account and merchant name, normalized for case
and whitespace. Many transactions share one schedule. Later reviews of that merchant reuse the schedule; historical
approvals cannot create duplicates or rewind its date. An existing payment task
can also be selected in the editor. Editing a linked schedule uses the same task
version checks as editing it in Tasks. These links do not mark payments paid or
automatically reconcile transactions with completed occurrences.

Approving a schedule promotes earlier untouched AI classifications for that
account/merchant to Recurring. Manually categorized or subsequently edited
transactions retain their categories, while still belonging to the arrangement.
Future charges reuse the approved schedule without another approval. Historical
context remains read-only to the model: this bounded promotion is an application
operation after schedule approval, not arbitrary model edits to past payments.

Migration 12 preserves saved choices, adds classification ownership/undo records,
and requeues pending suggestions under the new policy. It does not infer AI
ownership for annotations saved before ownership tracking existed. The JSON
export includes linked payment tasks on entries; SQL backups also retain undo
records and inbox decisions.

The API process checks the durable PostgreSQL queue every five seconds after a
batch finishes, including when no browser is open. New arrivals are prioritized
before remaining history. One database advisory lock prevents concurrent worker
runs; abandoned processing is recovered on restart. Failed model calls retry
with a one-minute delay, up to three attempts, before offering **Retry failed
reviews** in the inbox. Results are discarded if assistant preferences or the
model connection changed during generation. Full SQL backups retain jobs,
suggestions and decisions; the existing JSON export does not include the inbox.
Bank fetching remains separate: this reviews transactions already in Haven and
does not add automatic bank polling or fetch older bank history.

- `GET /api/assistant/inbox?view=review|history&cursor=...`: items, undo availability and queue counts.
- `POST /api/assistant/inbox/{id}/undo`: restore pre-AI annotations if the applied revision is still current.
- `POST /api/assistant/inbox/{id}/dismiss`: retain a dismissal.
- `POST /api/assistant/inbox/{id}/apply`: atomically save reviewed annotations and any payment schedule.
- `POST /api/assistant/inbox/retry`: requeue failed reviews when enabled.


### Expected purchases and prepaid coverage

Upcoming uses compact icon/price chips. Chips sit together in a compact wrapping row; each row reserves space so hover or keyboard focus can reveal a name and push neighboring chips sideways without moving them to another row; click/tap opens details and editing. Small screens keep the icon and price; tap reveals the full name and details. The estimated spending total expands into Scheduled payments and Expected purchases. Per-plan inclusion switches persist; excluded coverage remains visible but contributes no money. Manage payment plans exposes active plans outside the 30-day horizon. Actual expenses remain independent of projections.

Payment tasks may carry a `plan`: scheduled, expected or prepaid. Expected purchases can have a date window and typical interval. Prepaid plans track days per unit, usual purchase quantity, a confirmed coverage end and a baseline date (`coverage_through`). Costs describe the total usual purchase, not a unit price or amortized monthly charge. Unknown timing/amount contributes an unconfirmed count, not fabricated money. One expected/prepaid plan contributes once to the horizon; scheduled occurrences each contribute once.

Transaction-product links persist separately from merchant associations. One merchant may sell several products; forecast plans never attach by merchant alone. A confirmed quantity extends known coverage from the later of current expiry and purchase date. Purchases through the baseline link without extending already-accounted coverage. The baseline defaults to today when a known expiry is saved without one, and is editable. Unknown starting coverage or duration stays unknown. Duplicate links do not extend twice. Irregular purchases advance their typical interval while retaining their date-window width; old backfills do not rewind it. A separate expected purchase date is shown as a payment, with coverage expiry in details; an expiry alone does not add an out-of-window purchase to this month's total.

Background review receives approved product plans, bounded linked history and any clarification answer. Ambiguous product/quantity can produce one short inbox question; answering queues the transaction again. A new plan still needs approval. An evidenced match with quantity to an approved forecast links automatically and updates coverage using deterministic arithmetic. Product matching remains an LLM judgment, not a merchant or price heuristic. Multiple purchases in a batch use current saved versions while concurrent user changes invalidate stale proposals. Manual annotation protection and undo remain in effect; undoing annotations does not undo a product purchase link.


### Infinite transaction feeds

Money activity and both inbox views use TanStack Query's `useInfiniteQuery` and TanStack Virtual's window virtualizer. Scrolling toward the loaded edge fetches the next 50 items; only the viewport and a small overscan are mounted. A focused row stays mounted for keyboard/menu interactions. Query requests consume cancellation signals, have explicit next-page retry UI, and keep existing rows visible on failure. Filters are part of the query key. Background refresh uses Query's sequential infinite-page refetch so cached page boundaries are rebuilt consistently, preserving the visible row when new items arrive above it. Polling pauses while hidden or offline and resumes on return. Inactive filter caches expire after five minutes; loaded pages remain available while scrolling back.

`GET /api/entries` supports month, account (either side of transfers), category, tag, search, payment-plan and unlinked-purchase filters. It returns `items`, `total` and `next_cursor`. Inbox uses the same cursor contract, with its date/creation-time/ID ordering. Cursors are opaque and scoped to filters/view; deletion of an earlier item cannot shift the next page. A new item above the current cursor appears on refresh. Search happens before paging. Monthly totals and balances come from the full ledger, independently of pages in the browser. `/state?entries=preview` caps attachment context at 200 entries; the default snapshot and exports remain complete. Payment-plan details query their own linked history, and the purchase picker searches beyond the preview.

Bank activity keeps the canonical transfer projection rather than paging raw debits and credits independently. For a reporting month, the backend reads that month's manual entries and a bank window extended six days on either side to retain reciprocal/ambiguous match checks. It then filters and pages the projected ledger. This bounds normal activity reads by month, but is not a persistent SQL ledger read model: full snapshots, all-history searches and review reconciliation still inspect the underlying history. A larger deployment can materialize that projection without changing the cursor API or frontend stack.
