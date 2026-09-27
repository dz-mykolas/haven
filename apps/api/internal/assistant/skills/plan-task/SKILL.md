---
name: plan-task
description: Draft purchases, appointments, tasks and payment reminders, with useful target dates and optional estimated costs.
---

## Decide what to draft

- A purchase intention (buy a hairdryer, replace a laptop, get new running shoes) is kind=task. A cost does not turn it into an appointment or payment reminder.
- A scheduled service or visit is kind=appointment. Paying for it does not change its kind.
- A bill or subscription due is kind=payment. Use only the recurrence the user states; a subscription is not necessarily monthly.
- Other actions and reminders are kind=task.

## Resolve dates without unnecessary questions

Use the supplied today and timezone. Resolve relative dates into calendar dates.
For a purchase/action requested "within", "in the next", or "by" a duration, use the end of that window as an editable target deadline. "In the next two weeks" means today + 14 calendar days. Do not ask which exact day to use. This is a target deadline, not a confirmed purchase date or booking. Briefly label it as a target in the response or notes.
For an appointment "in nine days", resolve today + 9 days. If no time is supplied, leave time empty and create the draft. Do not ask for an optional time before drafting; never fill midnight as a placeholder.
For relative calendar language with one clear interpretation, resolve it rather than asking the user to repeat it. Ask one focused question if dates conflict, the requested record is ambiguous, or a required date cannot be resolved (for example "sometime" with no timeframe).
For a subscription with no first due date or usable timeframe, ask when the next payment is due. Do not invent its billing cycle or first charge date.

## Estimated costs

Use estimated_min_minor and estimated_max_minor for purchases, appointments and payments. Convert EUR to integer-cent strings: "around €200" uses "20000" for both bounds; "€60–70" uses "6000" and "7000". Approximate wording does not justify inventing a wider range. Unknown/skipped costs use null for both; do not invent zero.
Keep amount_minor="0" for tasks and appointments. For a payment, an exact estimate may also populate amount_minor; a ranged or unknown estimate leaves it "0". These are output fields, not things to explain to the user.
Use dedicated estimate fields, not notes. When refining an earlier draft with an explicit "Estimated cost:" note, move that estimate into the fields and preserve unrelated notes.
Ask about a missing optional cost only when offer_estimated_costs is true, and only alongside an otherwise ready draft. Do not repeat the question after the user skips it or provides an estimate. A volunteered cost is accepted even when optional cost questions are off.
Saved costs appear in Money's upcoming projection. They do not create expenses, change balances, or confirm a payment. Completing a task does not prove it was paid. Automatic bank matching is unavailable.

## Follow-ups and recurring tasks

A supplied task with version=0 is an unsaved draft. Reuse its ID when refining it; use an empty ID only for a new task. Preserve all unrelated fields, including existing estimates, date, time, recurrence and notes. Use only supplied IDs for edits.
Editing a repeating task changes its series; mention that briefly when relevant. Do not manufacture separate duplicate reminders for future occurrences.

## Repeats, missed days and plans over time

- Use every for intervals ("every 10 days": repeat=daily, every=10) and weekdays for weekly repeats on chosen days ("Mondays and Thursdays": repeat=weekly, weekdays=[1,4]). Each chosen day is its own occurrence.
- Use until when the user gives an end ("for two months", "until the end of March"); resolve it to a date from the start date.
- Add the built-in tag "@skip-missed" to a repeating task that is a habit where a missed day simply passes, such as stretches, medication or language practice. Chores and bills that still need doing when late do not get it. Repeating appointments always skip missed days, and payments never do, so do not tag those.
- Set income=true when the amount is money coming in: selling something, a refund, salary or rent received.
- When the user describes a plan that changes over time ("stretches daily for two weeks, then weekly"), draft one task for the current step, set until for when it ends, and write the rest of the plan in its notes in the user's words. The follow-up skill handles the change when the time comes, so do not draft later steps as separate tasks.

## Examples

Example dates illustrate the rules; always calculate from the actual supplied today for the current request.

- Today 2026-09-24; "Need to buy a hairdryer in the next two weeks, around €200": draft kind=task, title="Buy hairdryer", date="2026-10-08", time="", repeat="none", amount_minor="0", estimated_min_minor="20000", estimated_max_minor="20000". Response: "Target: within two weeks." No date or time question.
- Today 2026-09-24; "Dentist in nine days": draft kind=appointment, date="2026-10-03", time="". Do not block on an optional time.
- Follow-up "It will cost €60–70": reuse that appointment's ID, date and time; set the estimate bounds, retaining its kind. Response: "Ready to review."
- "Netflix €13.99 monthly on the 5th starting next month": draft a monthly payment with the resolved next-month date and equal "1399" estimate bounds.
