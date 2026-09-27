import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("activity loads cursor pages on scroll, virtualizes rows and preserves full totals and filters", async ({
  page,
}) => {
  test.setTimeout(120000);
  const api = page.request;
  const account = crypto.randomUUID();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
  }).format(new Date());
  const month = date.slice(0, 7);
  const ids: string[] = [];
  const cursors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/entries" &&
      url.searchParams.get("month") === month
    )
      cursors.push(url.searchParams.get("cursor") ?? "");
  });
  try {
    const settings = await (await api.get("/api/assistant")).json();
    await api.put("/api/assistant/settings", {
      data: { ...settings.settings, mode: "manual" },
    });
    expect(
      (
        await api.put(`/api/accounts/${account}`, {
          data: {
            id: account,
            name: "Infinite wallet",
            currency: "EUR",
            opening_minor: "100000",
            version: 0,
          },
        })
      ).ok(),
    ).toBe(true);
    for (let batch = 0; batch < 26; batch++)
      await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          const n = batch * 10 + index;
          const id = `93000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
          ids.push(id);
          expect(
            (
              await api.put(`/api/entries/${id}`, {
                data: {
                  id,
                  account_id: account,
                  destination_id: "",
                  kind: "expense",
                  amount_minor: "100",
                  date,
                  payee: `Infinite purchase ${String(n + 1).padStart(3, "0")}`,
                  category: "",
                  tags: [],
                  notes: "",
                  deleted: false,
                  version: 0,
                },
              })
            ).ok(),
          ).toBe(true);
        }),
      );
    await page.goto(`/#money`);
    await expect(page.getByTestId("spending-total")).toHaveText("€260.00");
    const preview = await (
      await api.get(`/api/state?entries=preview&month=${month}`)
    ).json();
    expect(preview.entries).toHaveLength(200);
    expect(preview.spending_minor).toBe("26000");
    await expect(
      page.getByRole("button", { name: "Show more transactions" }),
    ).toHaveCount(0);
    const feed = page.locator('[data-feed="Transactions"]');
    await feed.scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", {
        name: "Edit Infinite purchase 001",
        exact: true,
      }),
    ).toBeVisible();
    for (let n = 0; n < 20; n++) {
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      if (
        await page
          .getByRole("button", {
            name: "Edit Infinite purchase 260",
            exact: true,
          })
          .count()
      )
        break;
      await page.waitForTimeout(150);
    }
    await expect(
      page.getByRole("button", {
        name: "Edit Infinite purchase 260",
        exact: true,
      }),
    ).toBeVisible();
    expect(new Set(cursors.filter(Boolean)).size).toBeGreaterThanOrEqual(5);
    expect(await feed.locator(".transaction-row").count()).toBeLessThan(40);
    await expect(page.getByTestId("spending-total")).toHaveText("€260.00");
    const lastPosition = (await page
      .getByRole("button", { name: "Edit Infinite purchase 260", exact: true })
      .boundingBox())!.y;
    const newest = "93000000-0000-4000-8000-000000000000";
    expect(
      (
        await api.put(`/api/entries/${newest}`, {
          data: {
            id: newest,
            account_id: account,
            destination_id: "",
            kind: "expense",
            amount_minor: "100",
            date,
            payee: "New first purchase",
            category: "",
            tags: [],
            notes: "",
            deleted: false,
            version: 0,
          },
        })
      ).ok(),
    ).toBe(true);
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
    await expect(page.getByTestId("spending-total")).toHaveText("€261.00");
    await expect(
      page.getByRole("heading", { name: "Activity 261", exact: true }),
    ).toHaveCount(1);
    await expect
      .poll(async () =>
        Math.abs(
          (await page
            .getByRole("button", {
              name: "Edit Infinite purchase 260",
              exact: true,
            })
            .boundingBox())!.y - lastPosition,
        ),
      )
      .toBeLessThan(3);
    const last = page.getByRole("button", {
      name: "Edit Infinite purchase 260",
      exact: true,
    });
    await last.click();
    const editor = page.getByRole("dialog");
    await editor
      .getByLabel("Payee / description")
      .fill("Renamed infinite purchase");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page
      .getByRole("button", { name: "Search and filter transactions" })
      .click();
    await page
      .getByLabel("Search transactions")
      .fill("Renamed infinite purchase");
    await expect(
      page.getByRole("button", {
        name: "Edit Renamed infinite purchase",
        exact: true,
      }),
    ).toBeVisible();
    await expect(feed.locator(".transaction-row")).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Clear transaction filters" })
      .click();
    await feed.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await api.delete(`/api/accounts/${account}`, { data: { version: 1 } });
  }
});

test("inbox scrolls through cursor pages, keeps DOM bounded and retries a failed page", async ({
  page,
}) => {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
  }).format(new Date());
  let fail = true;
  const requests: string[] = [];
  const items = Array.from({ length: 130 }, (_, i) => ({
    entry_id: `94000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    original: {
      id: `94000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      account_id: "",
      destination_id: "",
      kind: "expense",
      amount_minor: "499",
      date,
      payee: `History item ${i + 1}`,
      category: "",
      tags: [],
      notes: "",
      version: 1,
      deleted: false,
    },
    draft: null,
    status: "unchanged",
    created_at: `${date}T00:00:00Z`,
    reason: "",
    question: "",
    can_undo: false,
  }));
  await page.route("**/api/assistant/inbox?*", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") ?? "";
    requests.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    if (start === 50 && fail) {
      await route.fulfill({
        status: 503,
        json: { error: "Temporary page failure" },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: items.slice(start, start + 50),
        total: 130,
        next_cursor: start + 50 < 130 ? String(start + 50) : "",
        review_count: 0,
        pending_count: 0,
        failed_count: 0,
        enabled: true,
      },
    });
  });
  await page.goto("/#assistant");
  await page.getByRole("button", { name: /^Inbox/ }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const feed = page.locator('[data-feed="Inbox items"]');
  await expect(feed.locator("article").first()).toContainText("History item 1");
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(
    page.getByRole("button", { name: "Retry loading", exact: true }),
  ).toBeVisible();
  fail = false;
  await page
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    if (await feed.getByText("History item 130", { exact: true }).count())
      break;
    await page.waitForTimeout(150);
  }
  await expect(
    feed.getByText("History item 130", { exact: true }),
  ).toBeVisible();
  expect(requests).toContain("100");
  expect(await feed.locator("article").count()).toBeLessThan(35);
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toHaveCount(0);
});
