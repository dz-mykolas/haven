# Haven: first implementation

Decisions recorded 21 September 2026.

## Product and layout

Money, Tasks, and Assistant share a 960px maximum content width, centered in the space beside navigation and shrinking fluidly on smaller screens. This keeps page edges consistent and reduces the distance between transaction names and amounts. Assistant chat uses a centered 760px column, with message text capped at 70ch; structured draft cards can use the full chat width. These are content-based design choices, not prescribed Material breakpoints.

Assistant is the first navigation item, with Money and Tasks below it. Its page offers persisted assistance preferences and instruction-only skills; no conversation or live model execution is implemented yet. See [assistant scope](assistant.md). The two modules work independently of it. Desktop uses a collapsible left sidebar with labels when expanded and icons when collapsed; tablet widths default to the icon rail unless an explicit preference is saved. Mobile uses a left hamburger drawer with modal focus containment, Escape/backdrop dismissal, scroll locking, and automatic closing on module selection. The navigation remains available after rotating or resizing.

The interface takes cues from Material 3 Expressive: tonal surfaces, strong shape hierarchy, rounded controls, one prominent creation action, connected selection groups, and short transitions. Light/dark palettes use semantic roles: Money is green, Tasks blue, and Assistant violet. The sidebar, header, and page background share a neutral palette. Module colors apply within the main content to cards, controls, and dialogs through shared components; navigation icons retain their module colors for recognition even in the collapsed rail. System theme is the default; an override stays on the device. Icon actions have accessible names and tooltips. Color is accompanied by icons, labels, signs, or dates. Motion stays on surfaces: moving selection highlights, short directional panel entrances, subtle card hover elevation, and dialog/snackbar entrances. When a page opens, its parts slide in from their own side (tabs from the left, search and filters from the top, the calendar from the bottom, header actions from the right). The module title is the one text exception: it sits in the same place on every module, so switching changes it in place, with the icon swapping inside its circle and the word rolling up or down in sidebar order. Native Web Animations and CSS handle this without another dependency; rapid switches cancel/retarget motion, and resizing repositions navigation directly. Reduced motion is respected, including cancellation when the preference changes. These are custom React/CSS components, not a claim of certified Material compliance.

## Research that informed this slice

| Reference                                                                                                                                                                                                                                                 | Implementation observed                                                                                                                                | What Haven takes                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Actual: project structure](https://actualbudget.org/docs/contributing/project-details/) and [architecture](https://actualbudget.org/docs/contributing/project-details/architecture/)                                                                     | React UI; platform-independent financial core; SQLite database work in a browser worker or Node process; separate synchronization service.             | Separate financial rules from rendering. Transfers must not become spending. Its local database and synchronization engine solve a different deployment problem; Haven is currently server-authoritative. |
| [Vikunja repository](https://github.com/go-vikunja/vikunja), [frontend dependencies](https://github.com/go-vikunja/vikunja/blob/main/frontend/package.json), and [dates/reminders](https://vikunja.io/help/dates-and-reminders/)                          | Go API and Vue frontend; typed API generation; repeat schedules advance after completion; richer reminder and project settings.                        | Typed frontend/API boundary, explicit completion operations, persisted schedules. Haven starts with three repeat choices and a date list; no project hierarchy, Gantt charts, or rule builder.            |
| [Google's Expressive research](https://design.google/library/expressive-material-design-google-research) and [2026 usability paper](https://research.google/pubs/usability-hasnt-peaked-exploring-how-expressive-design-overcomes-the-usability-plateau/) | Research examines how color, shape, size, grouping, and motion help identify actions. It also cautions against sacrificing recognizable functionality. | Make primary actions easy to spot. Keep brief labels where icons alone would be ambiguous. Google's measured results are not performance or usability benchmarks for Haven.                               |

This is selective architectural/design research, not source-code reuse. No code from these applications was copied.

## Runtime and data boundaries

- Astro builds the web shell; React owns the interactive workspace. The static frontend calls a separate Go HTTP API. There is no Astro backend or duplicated financial calculation in JavaScript.
- Go domain functions own validation, recurrence, and totals. Store operations combine these rules with PostgreSQL transactions. HTTP handlers decode/encode requests. A later assistant can call the same operations.
- PostgreSQL is authoritative for this first web development slice. This replaces the original standalone-app assumption from the earlier brief. One implicit personal workspace; authentication and tenant isolation must precede any public deployment. The API refuses non-loopback listening addresses.
- EUR amounts are integer cents, encoded as strings over JSON. Aggregate arithmetic uses arbitrary precision. Balances derive from opening amounts and active transactions. Transfers are one atomic record with source/destination; they affect neither income nor spending.
- Financial dates are calendar dates, with the reporting month selected in the browser. All recorded entries affect balance; payment plans belong in Tasks rather than future transactions.
- Tasks save an IANA timezone from the device. The date and optional wall-clock time stay with that timezone across travel. Daily/weekly recurrence uses calendar days; monthly recurrence retains its original day and clamps short months. Completion advances **one** scheduled occurrence; overdue occurrences are not silently marked completed or skipped. The Tasks calendar is a Monday-first six-week month grid with a day agenda. Go projects future daily/weekly/monthly/yearly dates without creating extra task records; persisted completion dates remain visible. Future previews edit the underlying repeating task and cannot skip its next pending occurrence. Dates and times use each task’s saved timezone; the calendar is not an hourly, device-timezone conversion view. List/calendar preference stays on the device. Push/background scheduling, DST delivery rules, meetings, and invitations are not implemented.
- Create requests use stable client UUIDs; identical create retries are accepted. Edits require a matching version to prevent silent overwrites. Completion IDs are idempotency keys persisted with history. Deletion is soft, with immediate UI undo and deleted records retained in exports/backups.
- The API contract lives in `api/openapi.json`; `make generate` produces frontend types. Runtime Go validation remains authoritative. Contract and Go models must change together.

## Deliberate limits and next work

Money activity and inbox feeds use cursor APIs, TanStack Query and window virtualization. The browser bootstrap caps transaction context at 200; full totals and exports retain the complete ledger. No offline editing, synchronization queue, plugin framework, LLM runtime, production bank connector, or notification service is implemented. Stable IDs and versions are useful preparation, not an offline synchronization protocol.

Enable Banking has a sandbox-only Go adapter and a booked-EUR import path into Money; [setup and research](enable-banking.md) document the official Mock ASPSP flow. The registered mock connection has been verified with both SEB/Revolut scenario accounts. Bank records use independent Haven UUIDs, account-scoped stable provider references, exact cents, and authoritative booked balances. Raw source history remains separate from manual records. Money projects unique, reciprocal transfer pairs as one transfer and leaves ambiguous pairs unchanged. Imported financial details remain read-only; personal category IDs, tags and notes are stored separately from provider payloads and use their own optimistic version. Categories have stable IDs, so renaming or hiding one preserves assignments. Tags reuse a whitespace-normalized, case-insensitive catalog. Reconciliation against manual entries, background polling, and production access remain future work.

Public hosting needs authentication/authorization, deployment configuration, and an operational backup plan. Native mobile can use the same API first; true offline operation needs a separate design when chosen. No Haven license has been selected yet.

## Unified transaction reviews (24 September 2026)

Assistant now has Chat and Inbox views. One PostgreSQL queue covers existing and
new uncategorized, unedited transactions. Suggest too opts into background model
calls; a worker processes five at a time and prioritizes later arrivals. The inbox
uses To review / History with month grouping, a navigation count and a Money
shortcut. Opening a card does not mark it handled. Saving annotations and
resolving a review are atomic; dismissal is durable. Bank facts and record
versions are checked before saving, and settings/provider changes discard in-flight
results. No push delivery, automatic bank polling or payment matching is added.

## Payment history and simpler categorization (24 September 2026)

The LLM receives a bounded read-only sample of related and recent payments and
judges patterns itself. Retrieval performs no subscription classification.
Editable targets remain separate from historical context. Review proposals can
add purpose tags and carry a short reason; application validation preserves
existing tags/notes and rejects edits to history-only records. Tag-only proposals
are allowed when categorization is uncertain.

Recurring, Everyday and Occasional are the three default expense categories.
Purpose labels are tags. Recurrence describes an ongoing payment arrangement,
including annual payments and variable bills; repeated shopping alone does not
establish one. The LLM judges the supplied context without hardcoded recurrence
or price thresholds and can leave an uncertain category empty. Income remains a
transaction type with supported purpose tags rather than an expense category.

The development database is reset for this change, as authorized by the user.
Defaults are seeded directly; there is no legacy-category conversion or hidden
retired catalog. Custom categories remain supported. Migration 10 adds review
explanations.

## Shared recurring payment schedules (24 September 2026)

Recurring transactions can carry a payment task through manual entry, assistant
chat or inbox review. All three save the schedule with the annotations in one
transaction using the same task validation and version checks. The model only
prefills an editable draft; the category alone never invents a date or cadence.

An account/merchant association reuses the accepted task for further payments.
Case/whitespace matching prevents duplicate schedules; it does not infer recurrence.
Users can select an existing task for a merchant variant. Saving a historical
proposal cannot overwrite an already linked schedule with a new task. Task edits
remain explicit. Yearly schedules preserve their anchor day through short years.
No automatic paid-occurrence matching is introduced.

## Expressive UI and component foundation (24 September 2026)

The current visual system follows [Google's M3 Expressive research](https://design.google/library/expressive-material-design-google-research): use contrast, size, grouping and shape to direct attention toward the decision. The inbox uses compact grouped rows; chat drafts separate title, amount and date from the explanation available in review. Secondary actions live in a menu, and tags, notes and reasoning use disclosures. Duplicate Assistant headings and explanatory paragraphs were removed.

Inter Variable is the self-hosted interface font; Manrope Variable provides headings and large amounts. Neutral surfaces carry workspace accents, including portalled controls. Input fills are quiet, with visible keyboard focus. Menus, dialogs, disclosures, cards and switches have short transitions; reduced motion disables decorative transitions.

Monetary values use a shared palette across Money, Upcoming, Tasks, Assistant and editors: green for income, red for all recorded spending (including recurring transactions), and muted amber for estimated or planned amounts. Future payment schedules, task costs and Upcoming use amber even when an exact amount is expected; their amounts have not been recorded as spending. Transfers and balances stay neutral. The color belongs to the amount, while signs and labels retain its meaning independently of color. Income and spending summary arrows use the matching color without separate background tiles.

The Money overview separates the current balance from monthly flows through spacing. Income and spending form two rows with right-aligned amounts and subtle green/red backgrounds. On narrow screens the flow rows sit below the balance, preserving the same reading order and numeric alignment.

The web workspace uses Tailwind v4 and shadcn/ui's Radix Maia preset, initialized and installed with the CLI. Installed components include Button, Input, Textarea, Select, Dialog, Accordion, Switch, ScrollArea, DropdownMenu, Tooltip, Popover and Calendar. `FormSelect`, `Disclosure` and `DateField` compose these primitives to preserve form submission values, collapsed edits and direct date entry. The editor uses the installed ScrollArea instead of a bespoke scrollbar. Changes are styled in `styles/expressive.css`; the existing application styles occupy the lower `legacy` cascade layer.

Accounts use a shadcn dialog so nested editors share one modal system. Bank connection state lives outside the panel to preserve callback errors and selections when the panel closes. This is a Material-inspired implementation, not a claim of Material component certification.

The shell omits the redundant breadcrumb/date/refresh bar; mobile navigation retains its menu button. While visible and online, the app refreshes the server snapshot every 15 seconds and the review inbox every 6 seconds, with an immediate check on focus, return or reconnection. Automatic requests are serialized per feed, pause when hidden/offline, preserve unsaved editor values, and keep existing content on transient failures. Explicit actions retain their error/retry handling. This updates the UI after data reaches Haven; it does not poll the bank provider or add push delivery.

## Automatic categorization and recurring arrangements (24 September 2026)

The background review queue now applies supported categories/tags automatically for both backfill and new arrivals. Only a proposed future-payment schedule appears in To review; duplicates for one account/merchant are consolidated. History stores automatic outcomes and offers guarded undo of pre-AI annotations. Manual saves, explicit undo, concurrent edits and provider corrections protect the user's current data.

An approved account/merchant arrangement can link many charges. Approval promotes earlier untouched AI categories to Recurring; explicit manual classifications remain intact. Future charges reuse the same schedule without approval or duplicate tasks. The LLM still determines whether the history supports a new arrangement; repeated merchant visits alone do not establish recurrence. Existing schedules are reused unchanged, and charges do not mark reminder occurrences paid.

Migration 12 requeues pending drafts and records AI ownership going forward. Saved labels with no provenance are treated as user-owned. Undo changes only category/tags and never removes an approved schedule or rewrites bank facts.


Upcoming separates forecast intention from calendar obligations. Scheduled payments and voluntary expected purchases share one estimated-spending total with an expandable breakdown and persistent inclusion controls. Prepaid coverage is an independent balance of days, with a confirmed baseline; it is not a fixed monthly bill. Forecast reminders are opt-in. Product links are explicit, so multiple products from one merchant remain distinct. AI may ask a focused question before proposing a product plan and may link subsequent evidenced purchases to an approved plan; expiry arithmetic is deterministic. The UI uses shadcn popovers, switches, dialogs and animated disclosures around compact icon/price chips, with focus and touch equivalents for hover details.


Infinite scroll is reserved for growing transaction feeds, while Upcoming remains a compact set of plan chips. API cursors use stable date/ID ordering (plus creation time for reviews), are scoped to filters, and do not use numeric offsets. Bank transfers must be projected with all reciprocal candidates before filtering/paging. Query handles cancellation, sequential refresh and retry; Virtual limits mounted rows while preserving keyboard focus. This keeps the UI and network payloads bounded without introducing a second financial ledger.

## Brand icons and bank logos served by Haven (26 September 2026)

Plans and activity rows show brand logos from Simple Icons (CC0), embedded in the API binary (`make brand-icons` regenerates the catalogue). `GET /api/icons` matches whole brand words near the start of a name; everyday words that double as brand names never match, and unknown or local brands keep the generic icon. Bank account avatars use the logo listed in Enable Banking's bank directory. The API downloads it once without credentials (HTTPS only, images only, 512 KB cap) and caches it in PostgreSQL (migration 15). It is served with a sandboxing CSP. The browser only ever talks to Haven, and no third-party logo service is used.

## Upcoming timeline (27 September 2026)

The next 30 days in the Money card is a timeline instead of chip rows. Wide, plans stand in columns on a 30-day line; pointing at (or focusing) a column opens it along the line, each plan over its own date, while other columns compress aside and are marked inactive until pointed at. Columns are worked out once from the resting layout, so hovering never regroups them. Narrow, it is a vertical list of weeks. Plans due within a week carry an alarm badge (red within three days). The accounts in the expanded card are a compact, display-only row; the activity list keeps its own account filter.

## Flat style refresh (27 September 2026)

The experimental Glass style and its sidebar switch were removed; there is one style. It keeps its structure and gains detail rather than a new look. Every page title carries its module icon in a tinted circle; the selected page is underlined in the module's colour instead of a filled pill; Money's day headings show the day's net total (once the whole day has loaded); activity icon tiles are neutral; today in the calendar is circled as if by pen; cards and day groups use smaller radii. The theme uses Figtree for text, gives cards a hairline edge and soft lift (a faint light outline in dark), tints dividers with the module colour, and lights the page with one diffuse light of the module colour from the top left: mostly neutral, a little colour. Research on generic interfaces and Material 3's own findings pointed to edges, containment and one consistent signature as what was missing.

## Task follow-ups, schedules and the task editor (28 September 2026)

Tasks carry no special fields for plans that change over time; their notes are the instructions ("4000 IU for two months, then 2000 IU daily"). When notes change, the assistant reads them, keeps its own short note of the plan and picks a date to look again. If the notes state something the task's fields can hold (an end date, an interval, weekdays, income), it proposes setting it. On the check date, or when a one-off task is completed, it waits, updates the task, replaces it with a linked follow-on task (history reads as one chain), closes it, or asks in the Inbox. Approval follows the assistant setting: in **When I ask** every change is a suggestion with Accept and Dismiss (in the editor, on the task row and in the Inbox); in **Suggest too** it applies with Undo, like transaction categories. A suggestion made before the user edited the task is dropped, and the assistant looks again. There is no fallback logic: a failing model call is retried twice (after 1 and 10 minutes), then the task shows the failure until it is saved again. Follow-up state lives in its own table, so the assistant's writes never collide with the user's revisions. It is its own skill, with separate instructions for reading notes and for acting at a check; Go holds only the reply format and validation. The model sees only the one task, its scheduled and completed days, earlier tasks in its chain and the user's answers.

Repeats take an interval (every N days, weeks, months or years), weekdays for weekly repeats (each chosen day is its own occurrence) and an optional end date after which the task is done. Tasks have their own tags, separate from Money's. Built-in tags are stored by ID and change behaviour: **Skip if missed** (`@skip-missed`) lets missed days lapse instead of staying overdue. It is optional on tasks, always on (shown locked) for repeating appointments, whose missed dates have simply passed, and never on payments, which still have to be paid. Every type's amount can be a cost or income; income plans show in green, count as expected money in rather than spending, and link to incoming bank transfers the way bills link to charges. The type is still called Payment when the money comes in (salary, rent received).

The task editor was rebuilt around this: title and notes on top, then one line of quiet items (type, date and time, repeat, money) and a line of tags. Tapping an item opens its settings as the lowest row; empty details wait behind **+**. Tags use one chip design everywhere, built-in tags first, with an autocomplete that explains built-in tags and orders yours by use. The assistant's plan is not shown; only a suggestion waiting for approval or a failure is.

The transaction review now sends merchant summaries (recent payments plus older months condensed) and one line per other merchant instead of a fixed sample, includes notes, and skips reloading data when nothing changed.

## Tasks screen (28 September 2026)

The Tasks list follows Money's activity: each day is one card under a small heading ("Today", "Tomorrow", "Wed 30 Sep", the year only when different), overdue tasks gather in their own red group, and rows no longer repeat the date or show a type tile. Amounts sit on the right with a sign (amber "−" for planned costs, green "+" for income), whole euros without ".00" and cents set small as in Money; a day with two or more amounts shows a muted total. Tags have their own line of soft chips that stay compact until the row is hovered or focused. The whole left strip of a row completes it: the ring fills and a thin ring drains for three seconds while the circle becomes Undo, then the row slides out and its gap closes; dragging a row right completes it at once. Completion is only sent after the countdown, so undo needs no server support. The tabs show counts that follow the search, a day picked in the calendar joins them as a closable tab, and search grows into the free space while in use. The calendar shows whole weeks with the neighbouring months' dates very faint, one quiet dot for days with something planned (daily repeats excluded), no legend, and a one-line summary of the next seven days. The existing selection, view and list motions are reused throughout.
