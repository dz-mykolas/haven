import { selectOption } from "./select";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { money } from "../apps/web/src/lib/api";
import type { components } from "../apps/web/src/lib/api.generated";

test("bank sync in Money, refresh failure and disconnect (simulated API)", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = JSON.parse(
    fs.readFileSync("tests/fixtures/enable-banking/smoke.json", "utf8"),
  );
  const id = "10000000-0000-4000-8000-000000000001";
  let status: components["schemas"]["BankingStatus"] = {
    configured: true,
    environment: "SANDBOX",
    connections: [
      {
        id,
        bank: "Mock ASPSP",
        country: "LT",
        environment: "SANDBOX",
        status: "connected",
        valid_until: "2099-09-22T12:00:00Z",
        synced_at: "2026-09-22T12:00:00Z",
        accounts: fixture.accounts.map((a: any, i: number) => ({
          account: {
            name: a.info.name,
            details: a.info.details,
            currency: a.info.currency,
            identification_hash: `mock-account-${i}`,
            account_id: { iban: "" },
          },
          balances: a.balances,
          transactions: a.transactions.map((t: any) => ({
            ...t,
            booking_date: t.booking_date || "",
            value_date: t.value_date || "",
            creditor: t.creditor || { name: "" },
            debtor: t.debtor || { name: "" },
          })),
        })),
      },
    ],
  };
  let failRefresh = false;
  let imported = false;
  const annotations = new Map<
    string,
    { category_id: string; tags: string[]; notes: string; version: number }
  >();
  const accountIDs = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ];
  let projectedEntries: components["schemas"]["Entry"][] = [];
  await page.route("**/api/state?*", async (route) => {
    const original = await route.fetch();
    const data: components["schemas"]["Snapshot"] = await original.json();
    if (imported) {
      data.accounts.push(
        ...accountIDs.map((id, i) => ({
          id,
          name: fixture.accounts[i].info.details,
          currency: "EUR" as const,
          opening_minor: "0",
          version: 1,
          source: "enable_banking_sandbox" as const,
          bank_balance_minor: i === 0 ? "304923" : "67801",
        })),
      );
      let number = 0;
      for (const [i, a] of fixture.accounts.entries())
        for (const t of a.transactions) {
          if (t.status !== "BOOK" || t.entry_reference === "haven-transfer-in")
            continue;
          const transfer = t.entry_reference === "haven-transfer-out";
          data.entries.push({
            id: `30000000-0000-4000-8000-${String(++number).padStart(12, "0")}`,
            account_id: accountIDs[i],
            destination_id: transfer ? accountIDs[1] : "",
            kind: transfer
              ? "transfer"
              : t.credit_debit_indicator === "CRDT"
                ? "income"
                : "expense",
            amount_minor: t.transaction_amount.amount.replace(".", ""),
            date: t.booking_date,
            payee: transfer
              ? "Transfer"
              : t.creditor?.name || t.debtor?.name || "",
            category: "",
            notes: "",
            bank_description: t.remittance_information.join("\n"),
            deleted: false,
            version: 1,
            source: "enable_banking_sandbox",
          });
        }
      for (const e of data.entries) {
        const saved = annotations.get(e.id);
        if (saved) {
          Object.assign(e, saved);
          e.category =
            data.categories.find((c) => c.id === saved.category_id)?.name ?? "";
        }
      }
      data.tags = [
        ...new Set([
          ...data.tags,
          ...[...annotations.values()].flatMap((a) => a.tags),
        ]),
      ];
      data.balances[accountIDs[0]] = "304923";
      data.balances[accountIDs[1]] = "67801";
      data.total_minor = (BigInt(data.total_minor) + 372724n).toString();
      data.income_minor = (BigInt(data.income_minor) + 240000n).toString();
      data.spending_minor = (BigInt(data.spending_minor) + 17276n).toString();
    }
    projectedEntries = data.entries;
    return route.fulfill({ json: data });
  });
  await page.route("**/api/entries?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const account = params.get("account");
    const search = (params.get("search") || "").toLowerCase();
    const items = projectedEntries
      .filter(
        (entry) =>
          (!account ||
            entry.account_id === account ||
            entry.destination_id === account) &&
          entry.payee.toLowerCase().includes(search),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    await route.fulfill({
      json: { items, total: items.length, next_cursor: "" },
    });
  });
  await page.route("**/api/banking**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/annotations")) {
      const body = request.postDataJSON();
      expect(Object.keys(body).sort()).toEqual([
        "category_id",
        "notes",
        "payment_units",
        "tags",
        "version",
      ]);
      const saved = { ...body, version: body.version + 1 };
      annotations.set(path.split("/").at(-2)!, saved);
      return route.fulfill({ json: saved });
    }
    if (path.endsWith("/refresh") && failRefresh)
      return route.fulfill({
        status: 502,
        json: {
          error:
            "Enable Banking could not complete the request. Please try again.",
        },
      });
    if (path.endsWith("/refresh")) imported = true;
    if (path.endsWith("/disconnect"))
      status = {
        ...status,
        connections: [],
      };
    if (path.endsWith("/banks"))
      return route.fulfill({
        json: {
          banks: [
            {
              name: "Mock ASPSP",
              country: "LT",
              maximum_consent_validity: 86400,
              psu_types: ["personal"],
            },
          ],
        },
      });
    return route.fulfill({ json: status });
  });
  await page.goto("/#money");
  const region = page.getByRole("region", { name: "Bank connections" });
  await expect(region).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Filter account" }),
  ).toHaveCount(0);
  await page.getByLabel("Reporting month").fill("2026-09");
  const initial = await (
    await page.request.get("/api/state?month=2026-09")
  ).json();
  const expectedBalance = money(
    (BigInt(initial.total_minor) + 372724n).toString(),
  );
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await expect(region.getByText("Mock ASPSP", { exact: true })).toBeVisible();
  await region
    .locator("summary")
    .filter({ hasText: "Mock SEB everyday" })
    .click();
  await expect(
    region.getByText("13 transactions", { exact: false }),
  ).toBeVisible();
  await expect(
    region.getByText("2026-09-01 · Booked", { exact: true }),
  ).toBeVisible();
  await expect(
    region.getByText("Date not supplied · Pending", { exact: true }),
  ).toBeVisible();
  const rows = region
    .locator(".bank-account")
    .first()
    .locator(".bank-transactions li");
  await expect(rows).toHaveCount(13);
  await region
    .getByRole("button", { name: "Refresh Mock ASPSP", exact: true })
    .click();
  await expect(region.getByRole("status")).toHaveText(
    "Test accounts synced to Money.",
  );
  await expect(rows).toHaveCount(13);
  await expect(page.getByTestId("total-balance")).toHaveText(expectedBalance);
  await expect(page.getByTestId("income-total")).toHaveText(
    money((BigInt(initial.income_minor) + 240000n).toString()),
  );
  await expect(page.getByTestId("spending-total")).toHaveText(
    money((BigInt(initial.spending_minor) + 17276n).toString()),
  );
  await page.getByRole("button", { name: "Close accounts" }).click();
  await expect(
    page.getByRole("heading", {
      name: `Activity ${initial.entries.length + 13}`,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search and filter transactions" })
    .click();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("Transfer");
  await expect(
    page.getByRole("button", { name: "View Transfer", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "View Transfer", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Bank transaction" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Recorded transaction" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Amount · EUR")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("Online shop");
  await page
    .getByRole("button", { name: "View Online shop", exact: true })
    .click();
  await selectOption(
    page.getByRole("dialog").getByLabel("Category", { exact: true }),
    { label: "Everyday" },
  );
  await page
    .getByRole("dialog")
    .locator('.annotation-details [data-slot="accordion-trigger"]')
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Tags", { exact: true })
    .fill("Work");
  await page
    .getByRole("dialog")
    .getByLabel("Tags", { exact: true })
    .press("Enter");
  await page
    .getByRole("dialog")
    .getByLabel("Personal note")
    .fill("Submit receipt for reimbursement");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A second sync must reload the main view without duplicating rows.
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await region
    .getByRole("button", { name: "Refresh Mock ASPSP", exact: true })
    .click();
  await expect(region.getByRole("status")).toHaveText(
    "Test accounts synced to Money.",
  );
  await page.getByRole("button", { name: "Close accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Activity 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View Online shop", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator('.annotation-details [data-slot="accordion-trigger"]')
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Personal note"),
  ).toHaveValue("Submit receipt for reimbursement");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Remove tag Work" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByLabel("Category", { exact: true }),
  ).toHaveText("Everyday");
  await page
    .getByRole("dialog")
    .locator('.bank-description [data-slot="accordion-trigger"]')
    .click();
  await expect(
    page.getByRole("dialog").locator(".bank-description p"),
  ).toContainText("Synthetic Haven test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Clear transaction filters" }).click();
  await page
    .getByRole("button", { name: "Search and filter transactions" })
    .click();
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await page
    .getByRole("button", { name: "Show transactions for Mock Revolut pocket" })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear transaction filters" }).click();
  await page
    .getByRole("button", { name: "Search and filter transactions" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search transactions" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("Online shop");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear transaction filters" }).click();
  await page
    .getByRole("button", { name: "Search and filter transactions" })
    .click();
  await page.getByRole("button", { name: "Manage accounts" }).click();
  failRefresh = true;
  await region
    .getByRole("button", { name: "Refresh Mock ASPSP", exact: true })
    .click();
  await expect(region.getByRole("alert")).toContainText("could not complete");
  await expect(rows).toHaveCount(13);
  await expect(page.getByTestId("total-balance")).toHaveText(expectedBalance);
  await region
    .getByRole("button", { name: "Connect test bank", exact: true })
    .click();
  await expect(
    region.getByRole("combobox", { name: "Test bank", exact: true }),
  ).toContainText("Mock ASPSP");
  await region.getByRole("button", { name: "Cancel bank selection" }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getTiming().iterations !== Infinity,
              ).length,
        ),
      )
      .toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/test-results/bank-sandbox-${theme}.png`,
    });
    await page.getByRole("button", { name: "Close accounts" }).click();
    await expect(
      page.getByRole("dialog", { name: "Accounts & banks" }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `.local/test-results/money-bank-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Manage accounts" }).click();
  }
  await region
    .getByRole("button", { name: "Disconnect Mock ASPSP", exact: true })
    .click();
  await expect(region.getByRole("status")).toContainText("disconnected");
  await expect(
    region.getByRole("button", { name: "Refresh Mock ASPSP", exact: true }),
  ).toHaveCount(0);
  await expect(region.locator(".bank-connection")).toHaveCount(0);
  await expect(page.getByTestId("total-balance")).toHaveText(expectedBalance);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Manage accounts" }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("bank callback opens account management and keeps a sync failure visible", async ({
  page,
}) => {
  let refreshes = 0;
  await page.route("**/api/banking**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/refresh")) {
      refreshes++;
      return route.fulfill({
        status: 502,
        json: {
          error: "Bank is temporarily unavailable. Try refreshing again.",
        },
      });
    }
    return route.fulfill({
      json: { configured: true, environment: "SANDBOX", connections: [] },
    });
  });
  await page.goto(
    "/?banking=connected&connection=10000000-0000-4000-8000-000000000001#money",
  );
  const panel = page.getByRole("dialog", { name: "Accounts & banks" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  expect(refreshes).toBe(1);
  await expect(page).toHaveURL(/\/#money$/);
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  expect(refreshes).toBe(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Manage accounts" }),
  ).toBeFocused();
});
