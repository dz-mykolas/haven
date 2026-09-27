import { test, expect } from "@playwright/test";
import type { Snapshot } from "../apps/web/src/lib/api";

test.use({ reducedMotion: "reduce" });

test("new transactions refresh while visible, resume on return, and preserve unsaved edits", async ({
  page,
}) => {
  const base = await (await page.request.get("/api/state")).json();
  const wallet = {
    id: crypto.randomUUID(),
    name: "Live wallet",
    currency: "EUR" as const,
    opening_minor: "10000",
    version: 1,
  };
  const snapshot: Snapshot = {
    ...base,
    accounts: [wallet],
    entries: [],
    tasks: [],
    balances: { [wallet.id]: "10000" },
    total_minor: "10000",
    income_minor: "0",
    spending_minor: "0",
    upcoming: { ...base.upcoming, items: [], unknown_count: 0 },
  };
  const inbox = {
    ...(await (await page.request.get("/api/assistant/inbox")).json()),
    items: [],
    review_count: 0,
    pending_count: 0,
    failed_count: 0,
  };
  let stateRequests = 0;
  let inboxRequests = 0;
  let fail = false;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  await page.route("**/api/state?**", async (route) => {
    stateRequests++;
    if (hold) await hold;
    if (fail) await route.abort("failed");
    else await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/entries?**", async (route) => {
    await route.fulfill({
      json: {
        items: snapshot.entries,
        total: snapshot.entries.length,
        next_cursor: "",
      },
    });
  });
  await page.route("**/api/assistant/inbox?**", async (route) => {
    inboxRequests++;
    await route.fulfill({ json: inbox });
  });
  await page.clock.install();
  await page.goto("/#money");
  await expect(page.getByTestId("total-balance")).toHaveText("€100.00");
  // Pause just ahead of the page's own clock (it can run slightly ahead of
  // the test's, and a clock can't be paused in its past).
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveCount(0);

  snapshot.total_minor = "9500";
  snapshot.entries = [
    {
      id: crypto.randomUUID(),
      account_id: wallet.id,
      destination_id: "",
      kind: "expense",
      amount_minor: "500",
      date: new Date().toISOString().slice(0, 10),
      payee: "New incoming transaction",
      category: "",
      tags: [],
      notes: "",
      deleted: false,
      version: 1,
    },
  ];
  inbox.review_count = 1;
  await page.clock.runFor(15000);
  await expect(page.getByTestId("total-balance")).toHaveText("€95.00");
  await expect(
    page.getByRole("button", { name: "Review suggestions · 1" }),
  ).toBeVisible();
  // The activity list keeps its own 15 s timer, started as the page settled
  // (possibly just after the clock was paused); give it a moment to fire.
  await page.clock.runFor(1000);
  await page
    .getByRole("button", { name: "Edit New incoming transaction", exact: true })
    .click();
  await page.getByLabel("Payee / description").fill("Unsaved merchant edit");
  snapshot.total_minor = "9000";
  await page.clock.runFor(15000);
  await expect(page.getByTestId("total-balance")).toHaveText("€90.00");
  await expect(page.getByLabel("Payee / description")).toHaveValue(
    "Unsaved merchant edit",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();

  snapshot.total_minor = "8500";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(200);
  await expect(page.getByTestId("total-balance")).toHaveText("€85.00");

  fail = true;
  const beforeFailure = stateRequests;
  await page.clock.runFor(15000);
  await expect.poll(() => stateRequests).toBeGreaterThan(beforeFailure);
  await expect(page.getByTestId("total-balance")).toHaveText("€85.00");
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenCounts = [stateRequests, inboxRequests];
  await page.clock.runFor(60000);
  expect([stateRequests, inboxRequests]).toEqual(hiddenCounts);

  fail = false;
  snapshot.total_minor = "8000";
  inbox.review_count = 2;
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(60000);
  expect([stateRequests, inboxRequests]).toEqual(hiddenCounts);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(200);
  await expect(page.getByTestId("total-balance")).toHaveText("€80.00");
  await expect(
    page.getByRole("button", { name: "Review suggestions · 2" }),
  ).toBeVisible();

  snapshot.total_minor = "7500";
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(200);
  await expect(page.getByTestId("total-balance")).toHaveText("€75.00");

  // A slow response must not cause repeated overlapping polls.
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const beforeSlow = stateRequests;
  await page.clock.runFor(15000);
  await expect.poll(() => stateRequests).toBe(beforeSlow + 1);
  await page.clock.runFor(45000);
  expect(stateRequests).toBe(beforeSlow + 1);
  release!();
  hold = undefined;
});
