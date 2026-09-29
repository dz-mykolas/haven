import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// Fixed calendar and seeded choices make fixtures and references reproducible.
const start = "2026-03-01",
  end = "2026-09-22";
const out = path.resolve("tests/fixtures/enable-banking");
let seed = 20260301;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const integer = (a, b) => a + Math.floor(random() * (b - a + 1));
const pick = (values) => values[integer(0, values.length - 1)];
const iso = (d) => d.toISOString().slice(0, 10);
const date = (m, d) =>
  `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const shift = (day, n) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const holidays = new Set([
  "2026-03-11",
  "2026-04-06",
  "2026-05-01",
  "2026-06-24",
  "2026-07-06",
]);
const business = (day) => {
  while (
    [0, 6].includes(new Date(day + "T12:00:00Z").getUTCDay()) ||
    holidays.has(day)
  )
    day = shift(day, 1);
  return day;
};
const decimal = (n) =>
  `${Math.trunc(n / 100)}.${String(n % 100).padStart(2, "0")}`;
const accounts = [
  {
    key: "seb",
    id: "HAVEN-LIFE-SEB-2026",
    label: "SEB · Everyday",
    opening: 180000,
    entries: [],
  },
  {
    key: "revolut",
    id: "HAVEN-LIFE-REVOLUT-2026",
    label: "Revolut · Daily spending",
    opening: 18000,
    entries: [],
  },
];
const annotations = [];
const transfers = [];
let sequence = 0;
function add(
  account,
  day,
  amount,
  merchant,
  purpose,
  {
    income = false,
    card = false,
    tags = [],
    note = "",
    description = "",
    link = "",
    reference = "",
  } = {},
) {
  const booking = card ? business(shift(day, 1)) : business(day);
  if (booking > end) return null;
  assert(amount > 0 && Number.isInteger(amount));
  const ref =
    reference ||
    `life26-${account}-${day.replaceAll("-", "")}-${String(++sequence).padStart(4, "0")}`;
  const entry = {
    entry_reference: ref,
    transaction_amount: { currency: "EUR", amount: decimal(amount) },
    credit_debit_indicator: income ? "CRDT" : "DBIT",
    status: "BOOK",
    booking_date: booking,
    value_date: booking,
    creditor: income ? null : { name: merchant },
    debtor: income ? { name: merchant } : null,
    remittance_information: [
      description ||
        `${card ? "Card purchase" : "Payment"} · ${merchant}${card ? ` · ${day}` : ""}`,
    ],
  };
  accounts[account].entries.push(entry);
  annotations.push({
    account: accounts[account].id,
    entry_reference: ref,
    tags: [...new Set([...(purpose ? [purpose] : []), ...tags])],
    note,
    purchase_date: day,
    ...(link ? { related_reference: link } : {}),
  });
  return ref;
}
function transfer(
  day,
  amount,
  description = "Monthly spending allowance",
  from = 0,
  to = 1,
) {
  const reference = `life26-transfer-${day.replaceAll("-", "")}-${from}-${to}`;
  const debit = add(from, day, amount, accounts[to].label, "", {
    description,
    reference: reference + "-out",
  });
  const credit = add(to, day, amount, accounts[from].label, "", {
    income: true,
    description,
    reference: reference + "-in",
  });
  if (debit && credit)
    transfers.push({
      date: business(day),
      amount_minor: amount,
      from: accounts[from].id,
      to: accounts[to].id,
      debit,
      credit,
    });
}
const vacation = (day) => day >= "2026-07-15" && day <= "2026-07-21";
for (let m = 3; m <= 9; m++) {
  const month = String(m).padStart(2, "0");
  add(
    0,
    date(m, 1),
    m >= 7 ? 265000 : 245000,
    "UAB Northstar Digital (synthetic)",
    "Salary",
    {
      income: true,
      description: `Net salary · ${month}/2026`,
      note: m === 7 ? "First salary after July pay rise." : "",
    },
  );
  add(
    0,
    date(m, 3),
    m >= 7 ? 75000 : 70000,
    "Apartment rent (synthetic landlord)",
    "Home",
    {
      description: `Vilnius apartment rent · ${month}/2026`,
      note: m === 7 ? "Lease renewal: rent increased by €50." : "",
    },
  );
  transfer(date(m, 2), 65000);
  transfer(date(m, 16), 30000, "Second-half spending allowance");
  add(0, date(m, 6), 1990, "Telia", "Home", {
    description: `Home internet · ${month}/2026`,
  });
  add(0, date(m, 15), 1790, "BITĖ", "Phone", {
    description: `Mobile plan · ${month}/2026`,
  });
  add(
    0,
    date(m, 12),
    [6184, 5526, 4729, 4316, 5150, 4892, 4628][m - 3],
    "Ignitis",
    "Home",
    { description: `Electricity invoice · ${month}/2026` },
  );
  add(
    0,
    date(m, 14),
    [11240, 7640, 2860, 1930, 1820, 1850, 2110][m - 3],
    "Vilniaus šilumos tinklai",
    "Home",
    { description: `Heating and hot water · ${month}/2026` },
  );
  add(
    0,
    date(m, 17),
    [1690, 1580, 1820, 1710, 1430, 1910, 1670][m - 3],
    "Vilniaus vandenys",
    "Home",
    { description: `Water invoice · ${month}/2026` },
  );
  add(0, date(m, 5), 2990, "Gym+", "Fitness", {
    description: "Monthly gym membership",
  });
  add(0, date(m, 20), 1250, "Lietuvos draudimas", "Home", {
    description: "Monthly home contents insurance",
  });
  add(1, date(m, 2), 3800, "JUDU", "Transport", {
    description: "30-day public transport pass",
  });
  add(1, date(m, 7), m >= 7 ? 1599 : 1199, "Netflix", "Entertainment", {
    card: true,
    description: "Netflix monthly membership",
    note: m === 7 ? "Changed streaming plan this month." : "",
  });
  add(1, date(m, 11), 899, "Spotify Premium", "Entertainment", {
    card: true,
    description: "Spotify Premium monthly membership",
  });
  add(1, date(m, 13), 299, "Apple iCloud+", "Software", {
    card: true,
    description: "iCloud+ monthly storage",
  });
  if (m <= 5 || m >= 8)
    add(1, date(m, 19), 999, "Discord Nitro", "Entertainment", {
      card: true,
      description: "Discord Nitro monthly membership",
      note:
        m === 5
          ? "Cancelled after this billing cycle."
          : m === 8
            ? "Restarted Nitro after a two-month break."
            : "",
    });
  // Grocery baskets vary, while larger shops and small top-ups remain habitual.
  for (const d of [4, 11, 18, 25])
    if (!vacation(date(m, d)))
      add(
        1,
        date(m, d),
        integer(3250, 5870),
        pick(["Lidl", "MAXIMA", "Rimi"]),
        "Groceries",
        { card: true },
      );
  for (const d of [8, 16, 23])
    if (!vacation(date(m, d)))
      add(
        1,
        date(m, d),
        integer(640, 1740),
        pick(["IKI", "Rimi", "MAXIMA"]),
        "Groceries",
        { card: true },
      );
  // Coffee and office lunches happen on selected workdays, not every date.
  for (let d = 1; d <= 31; d++) {
    const day = date(m, d);
    if (iso(new Date(day + "T12:00:00Z")) !== day || day > end || vacation(day))
      continue;
    const weekday = new Date(day + "T12:00:00Z").getUTCDay();
    if (holidays.has(day)) continue;
    if ([1, 3, 5].includes(weekday) && random() < 0.65)
      add(
        1,
        day,
        pick([290, 320, 350, 380, 420]),
        pick(["Caffeine", "Huracán Coffee"]),
        "Dining",
        { card: true },
      );
    if ([2, 4].includes(weekday) && random() < 0.7)
      add(
        1,
        day,
        integer(790, 1290),
        pick(["iLunch", "Fresh Post", "Daily"]),
        "Dining",
        { card: true, description: "Lunch during the workday" },
      );
  }
  for (const d of [10, 24])
    if (!vacation(date(m, d)))
      add(
        1,
        date(m, d),
        integer(1890, 3290),
        pick(["Wolt", "Bolt Food"]),
        "Dining",
        { card: true },
      );
  add(
    1,
    date(m, 21),
    integer(2250, 4650),
    pick(["Jurgis ir Drakonas", "Talutti", "Vapiano"]),
    "Dining",
    {
      card: true,
      tags: ["Friends"],
      note: m === 4 ? "Dinner with friends." : "",
    },
  );
  for (const d of [9, 22, 28])
    if (!vacation(date(m, d)))
      add(1, date(m, d), integer(470, 1390), "Bolt", "Transport", {
        card: true,
      });
  if (m !== 7)
    add(1, date(m, 26), integer(950, 1590), "Forum Cinemas", "Entertainment", {
      card: true,
    });
  if (m % 2 === 1)
    add(1, date(m, 8), integer(1240, 2840), "Eurovaistinė", "Health", {
      card: true,
    });
  if (m % 2 === 0)
    add(1, date(m, 9), integer(1650, 4190), "Drogas", "Shopping", {
      card: true,
    });
}
// Irregular life events, linked refunds, a business claim, and travel preparation.
add(
  0,
  "2026-04-01",
  35000,
  "UAB Northstar Digital (synthetic)",
  "Other income",
  { income: true, description: "Quarterly performance bonus" },
);
add(1, "2026-03-21", 7995, "Deichmann", "Shopping", {
  card: true,
  note: "Everyday trainers.",
});
add(1, "2026-03-23", 1999, "Bitwarden Premium", "Software", {
  card: true,
  description: "Annual subscription renewal",
  note: "Annual renewal; not a monthly charge.",
});
for (const day of [
  "2026-03-07",
  "2026-04-11",
  "2026-05-16",
  "2026-06-20",
  "2026-07-25",
  "2026-08-29",
])
  add(1, day, 2500, "Barber in Vilnius (synthetic)", "Health", { card: true });
const hotel = add(1, "2026-04-10", 8900, "Kaunas hotel (synthetic)", "Travel", {
  card: true,
  tags: ["Work", "Reimbursable"],
  note: "Client visit; claim reimbursed on 20 April.",
});
add(1, "2026-04-10", 1660, "LTG Link", "Travel", {
  card: true,
  tags: ["Work", "Reimbursable"],
  note: "Return rail ticket for the client visit.",
});
add(0, "2026-04-20", 10560, "UAB Northstar Digital (synthetic)", "Refund", {
  income: true,
  description: "Expense claim reimbursement · hotel and train",
  tags: ["Work"],
  link: hotel,
});
const returned = add(1, "2026-05-08", 6490, "Zalando", "Shopping", {
  card: true,
  note: "Jacket returned because the size was wrong.",
});
add(1, "2026-05-19", 6490, "Zalando", "Refund", {
  income: true,
  description: "Refund for returned jacket",
  link: returned,
});
add(1, "2026-05-22", 7800, "Bicycle workshop (synthetic)", "Transport", {
  card: true,
  note: "Annual bike service and a new chain.",
});
transfer("2026-06-03", 50000, "Summer trip bookings");
add(1, "2026-06-04", 14890, "Ryanair", "Travel", {
  card: true,
  tags: ["Italy trip"],
  note: "Return flights for 15–21 July.",
});
add(1, "2026-06-10", 42000, "Booking.com", "Travel", {
  card: true,
  tags: ["Italy trip"],
  note: "Six nights in Bologna; sharing the room with a friend.",
});
add(0, "2026-06-18", 9999, "Pigu.lt", "Shopping", {
  card: true,
  note: "Replacement headphones.",
});
transfer("2026-07-10", 35000, "Spending money for Italy");
for (const [day, merchant, amount, category] of [
  ["2026-07-15", "Trenitalia", 3290, "Travel"],
  ["2026-07-15", "Coop Italia", 1845, "Groceries"],
  ["2026-07-16", "Bologna trattoria (synthetic)", 2850, "Dining"],
  ["2026-07-16", "TPER", 460, "Transport"],
  ["2026-07-17", "Florence museum (synthetic)", 2500, "Entertainment"],
  ["2026-07-17", "Italian café (synthetic)", 740, "Dining"],
  ["2026-07-18", "Conad", 2135, "Groceries"],
  ["2026-07-18", "Trenitalia", 3290, "Travel"],
  ["2026-07-19", "Bologna pizzeria (synthetic)", 2290, "Dining"],
  ["2026-07-20", "Gelateria (synthetic)", 650, "Dining"],
  ["2026-07-21", "Marconi Express", 1280, "Travel"],
])
  add(1, day, amount, merchant, category, { card: true, tags: ["Italy trip"] });
add(1, "2026-07-24", 21000, "Travel companion (synthetic)", "Refund", {
  income: true,
  description: "Your half of the Bologna hotel",
  tags: ["Italy trip"],
  note: "Shared accommodation reimbursement.",
});
add(1, "2026-08-06", 9500, "Dental clinic (synthetic)", "Health", {
  card: true,
  note: "Dental check-up and cleaning.",
});
// Same merchant/date/amount are not sufficient evidence of a duplicate.
add(1, "2026-08-12", 2490, "Wolt", "Dining", {
  card: true,
  description: "Card payment · order A",
});
const duplicate = add(1, "2026-08-12", 2490, "Wolt", "Dining", {
  card: true,
  description: "Card payment · duplicate charge",
  note: "Second charge for the same order; reversed on 14 August.",
});
add(1, "2026-08-14", 2490, "Wolt", "Refund", {
  income: true,
  description: "Reversal of duplicate charge",
  link: duplicate,
});
add(1, "2026-08-27", 7500, "Vinted", "Other income", {
  income: true,
  description: "Sale of a used jacket",
  tags: ["Decluttering"],
});
transfer("2026-09-08", 10000, "Move spare spending money back to SEB", 1, 0);
add(0, "2026-09-12", 12900, "IKEA", "Home", {
  card: true,
  note: "Desk and lamp for the home office.",
  tags: ["Home office"],
});

add(0, "2026-05-14", 74900, "Refurbed", "Shopping", {
  card: true,
  tags: ["Home office"],
  note: "Refurbished replacement laptop; old laptop stopped working.",
});
add(1, "2026-04-23", 8500, "Pigu.lt", "Shopping", {
  card: true,
  tags: ["Gifts"],
  note: "Birthday present for a sibling.",
});
for (const [day, amount] of [
  ["2026-03-27", 1999],
  ["2026-05-28", 1499],
  ["2026-08-28", 2999],
])
  add(1, day, amount, "Steam", "Entertainment", { card: true });
// Move unspent allowance back at month-end, keeping a small card-account buffer.
for (let m = 3; m <= 8; m++) {
  const last = iso(new Date(Date.UTC(2026, m, 0, 12)));
  let day = last;
  while ([0, 6].includes(new Date(day + "T12:00:00Z").getUTCDay()))
    day = shift(day, -1);
  const balance =
    accounts[1].opening +
    accounts[1].entries
      .filter((t) => t.booking_date <= day)
      .reduce(
        (n, t) =>
          n +
          (t.credit_debit_indicator === "CRDT" ? 1 : -1) *
            Number(t.transaction_amount.amount.replace(".", "")),
        0,
      );
  const amount = Math.floor((balance - 35000) / 10000) * 10000;
  if (amount >= 10000)
    transfer(day, amount, "Return unspent allowance to SEB", 1, 0);
}
const manifest = {
  version: 1,
  synthetic: true,
  seed: 20260301,
  period: { from: start, through: end, complete_months: 6 },
  person: {
    name: "Lukas Petrauskas (fictional)",
    location: "Vilnius, Lithuania",
    household:
      "One adult renting an apartment; salaried employee, no dependants",
    account_roles:
      "SEB receives salary and pays household bills. Revolut handles day-to-day card spending and subscriptions.",
  },
  subscriptions: [
    "Netflix",
    "Discord Nitro",
    "Spotify Premium",
    "Apple iCloud+",
    "Gym+",
    "Bitwarden Premium",
  ],
  accounts: [],
  transfers,
  months: [],
  notes: [
    "All people, amounts, account IDs and events are synthetic. Merchant names provide realistic statement labels; prices are illustrative, not verified current offers.",
    "Six complete months (March–August) and September through the 22nd. Salary arrives on the first business day; September is incomplete.",
    "Card bookings normally occur on the next business day. Recurring monthly bills have stable purchase dates but variable booking dates.",
    "Discord Nitro stops after May and resumes in August. Netflix changes plan in July. Bitwarden renews annually.",
    "Refunds and reimbursements are incoming cash flows, reported separately from salary in annotation suggestions.",
    "The source files contain BOOK entries only. Pending scenarios are separate to avoid the observed EB control-panel 422 issue.",
    "Annotation suggestions are a separate test oracle, not bank facts and not automatically assigned to Haven transactions.",
  ],
};
const references = new Set();
const documents = accounts.map((a) => {
  a.entries.sort(
    (x, y) =>
      x.booking_date.localeCompare(y.booking_date) ||
      x.entry_reference.localeCompare(y.entry_reference),
  );
  let balance = a.opening,
    min = balance;
  const monthly = new Map();
  for (const t of a.entries) {
    assert(!references.has(t.entry_reference));
    references.add(t.entry_reference);
    assert(t.booking_date >= start && t.booking_date <= end);
    const n = Number(t.transaction_amount.amount.replace(".", ""));
    balance += t.credit_debit_indicator === "CRDT" ? n : -n;
    min = Math.min(min, balance);
    const month = t.booking_date.slice(0, 7);
    if (!monthly.has(month))
      monthly.set(month, {
        month,
        income: 0,
        spending: 0,
        transfers_in: 0,
        transfers_out: 0,
      });
    const row = monthly.get(month);
    const isTransfer = t.entry_reference.startsWith("life26-transfer-");
    const key = isTransfer
      ? t.credit_debit_indicator === "CRDT"
        ? "transfers_in"
        : "transfers_out"
      : t.credit_debit_indicator === "CRDT"
        ? "income"
        : "spending";
    row[key] += n;
  }
  assert(min >= 0, `${a.key} goes overdrawn by ${min}`);
  manifest.accounts.push({
    key: a.key,
    identification: a.id,
    label: a.label,
    opening_minor: a.opening,
    closing_minor: balance,
    minimum_running_minor: min,
    transactions: a.entries.length,
    months: [...monthly.values()],
  });
  return {
    info: {
      name: manifest.person.name,
      details: a.label,
      currency: "EUR",
      cash_account_type: "CACC",
      usage: "PRIV",
      account_id: { other: { scheme_name: "OTHI", identification: a.id } },
      all_account_ids: [{ scheme_name: "OTHI", identification: a.id }],
    },
    balances: [
      {
        name: "Booked balance",
        balance_type: "CLBD",
        reference_date: end,
        balance_amount: { currency: "EUR", amount: decimal(balance) },
      },
    ],
    transactions: a.entries,
  };
});
for (let m = 3; m <= 9; m++) {
  const month = `2026-${String(m).padStart(2, "0")}`;
  const rows = manifest.accounts
    .flatMap((a) => a.months)
    .filter((r) => r.month === month);
  manifest.months.push({
    month,
    complete: m < 9,
    income_minor: rows.reduce((n, r) => n + r.income, 0),
    spending_minor: rows.reduce((n, r) => n + r.spending, 0),
  });
}
const opening = manifest.accounts.reduce((n, a) => n + a.opening_minor, 0),
  closing = manifest.accounts.reduce((n, a) => n + a.closing_minor, 0);
assert.equal(
  closing,
  opening +
    manifest.months.reduce((n, m) => n + m.income_minor - m.spending_minor, 0),
);
manifest.total_booked_records = documents.reduce(
  (n, a) => n + a.transactions.length,
  0,
);
manifest.money_transactions = manifest.total_booked_records - transfers.length;
manifest.total_closing_minor = closing;
fs.mkdirSync(out, { recursive: true });
const write = (name, value) =>
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + "\n");
accounts.forEach((a, i) =>
  write(a.key + ".json", { accounts: [documents[i]] }),
);
// Reconciliation expectations and label suggestions are internal test data.
write("scenario.json", { ...manifest, annotations });
console.log(
  `${manifest.total_booked_records} booked bank records, ${transfers.length} paired transfers, ${manifest.money_transactions} Money transactions.`,
);
for (const a of manifest.accounts)
  console.log(
    `${a.label}: ${a.transactions} records; opening €${decimal(a.opening_minor)} → closing €${decimal(a.closing_minor)}; minimum €${decimal(a.minimum_running_minor)}`,
  );
console.log(
  `Combined closing balance €${decimal(closing)}. Every cent reconciles.`,
);
