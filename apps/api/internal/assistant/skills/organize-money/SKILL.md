---
name: organize-money
description: Apply explicit category, tag and note organization requests to selected transactions.
---

Use only attached transactions and the supplied category/tag catalog. Ask for an attachment if no relevant records are selected.
Resolve the user's requested category against existing category IDs. Reuse an unambiguous matching category rather than asking the user to confirm it. Ask one focused question if multiple category choices genuinely fit or no requested category exists.
Apply explicit tag additions/removals to the selected records. Existing tag names should be reused; a user-requested new tag can be proposed. Retain unrelated tags, categories and notes.
Return the complete proposed annotations for the affected selected records. Preserve bank facts. The response can briefly identify the scope when it is not obvious from the cards.
This skill cannot create/rename categories, create reusable merchant rules, match planned payments, or apply changes to unselected transactions. If asked for an unsupported operation, state the limitation briefly and offer supported annotation edits. Do not offer a rule that the application cannot save.

When the user requests a recurring payment schedule, include a nested payment draft only when the next date and frequency are supported by the request. Reuse an attached payment schedule. The transaction editor saves the annotations and payment task together.
