import { selectOption } from "./select";
import { setDate, setMoney, setRepeat, setType } from "./task-editor";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Contrast is measured on the settled view, not halfway through a surface fade.
async function accessibility(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  return new AxeBuilder({ page }).analyze();
}

test.describe.configure({ mode: "serial" });
test("Money persists exact amounts, transfers, edits, deletion, undo and export", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  await page.getByLabel("Account name").fill("SEB");
  await page.getByLabel("Opening balance").fill("100");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("total-balance")).toHaveText("€100.00");
  async function transaction(payee: string, amount: string, kind = "expense") {
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
    await page.getByRole("button", { name: kind, exact: true }).click();
    await page.getByLabel("Amount · EUR", { exact: true }).fill(amount);
    await page.getByLabel("Payee / description").fill(payee);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await transaction("Coffee", "0.10");
  await transaction("Tea", "0.20");
  await expect(page.getByTestId("spending-total")).toHaveText("€0.30");
  await transaction("Salary", "1000", "income");
  await expect(page.getByTestId("income-total")).toHaveText("€1,000.00");
  await page
    .getByRole("button", { name: "Manage accounts", exact: true })
    .click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name").fill("Revolut");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Accounts & banks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close accounts" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await page.getByRole("button", { name: "transfer", exact: true }).click();
  await selectOption(page.getByLabel("From account"), { label: "SEB" });
  await selectOption(page.getByLabel("To account"), { label: "Revolut" });
  await page.getByLabel("Amount · EUR", { exact: true }).fill("25");
  await page.getByLabel("Description", { exact: true }).fill("Pocket money");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("total-balance")).toHaveText("€1,099.70");
  await expect(page.getByTestId("spending-total")).toHaveText("€0.30");
  await page.getByRole("button", { name: "Edit Tea", exact: true }).click();
  await page.getByLabel("Amount · EUR", { exact: true }).fill("2.20");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("spending-total")).toHaveText("€2.30");
  await page.getByRole("button", { name: "Edit Coffee", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("spending-total")).toHaveText("€2.20");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("spending-total")).toHaveText("€2.30");
  await page.reload();
  await expect(page.getByTestId("total-balance")).toHaveText("€1,097.70");
  await page.getByRole("button", { name: "Manage accounts" }).click();
  const categories = page.locator(".category-manager");
  await categories.locator("summary").click();
  await categories
    .getByRole("button", { name: "New category", exact: true })
    .click();
  await categories.getByLabel("New category name").fill("Tea & coffee");
  await categories.getByRole("button", { name: "Save category" }).click();
  await expect(
    categories.getByRole("button", { name: "Rename Tea & coffee" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close accounts" }).click();
  await page.getByRole("button", { name: "Edit Tea", exact: true }).click();
  await page
    .locator('.annotation-details [data-slot="accordion-trigger"]')
    .click();
  await selectOption(
    page.getByRole("dialog").getByLabel("Category", { exact: true }),
    { label: "Tea & coffee" },
  );
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
    .getByLabel("Tags", { exact: true })
    .fill("work");
  await page
    .getByRole("dialog")
    .getByLabel("Tags", { exact: true })
    .press("Enter");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Remove tag Work" }),
  ).toHaveCount(1);
  await page
    .getByRole("dialog")
    .getByLabel("Personal note")
    .fill("Client meeting; keep the receipt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await categories.locator("summary").click();
  await categories.getByRole("button", { name: "Rename Tea & coffee" }).click();
  await categories.getByLabel("Category name", { exact: true }).fill("Drinks");
  await categories.getByRole("button", { name: "Save category" }).click();
  await categories
    .getByRole("button", { name: "Hide category Drinks" })
    .click();
  await expect(
    categories.getByRole("button", { name: "Show category Drinks" }),
  ).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.getByRole("button", { name: "Close accounts" }).click();
  await page
    .getByRole("button", { name: "Search and filter transactions" })
    .click();
  await selectOption(page.getByRole("combobox", { name: "Filter category" }), {
    label: "Drinks",
  });
  await selectOption(page.getByRole("combobox", { name: "Filter tag" }), {
    label: "Work",
  });
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit Tea", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Category", { exact: true }),
  ).toHaveText("Drinks (hidden)");
  await page
    .getByRole("dialog")
    .locator('.annotation-details [data-slot="accordion-trigger"]')
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Personal note"),
  ).toHaveValue("Client meeting; keep the receipt");
  expect((await accessibility(page)).violations).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Clear transaction filters" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all data", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/^haven-.*\.json$/);
});

test("Tasks use device timezone and preserve monthly anchors without changing Money", async ({
  page,
}) => {
  await page.goto("/#tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task name").fill("Rent");
  await setType(page, "Payment");
  await setDate(page, "2027-01-31", "09:00");
  await setRepeat(page, "Monthly");
  await setMoney(page, "500");
  // The device timezone is saved without a field; another one would be noted.
  await expect(page.getByText(/^Times use/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete Rent", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Rent", exact: true }),
  ).toContainText("28 Feb 2027");
  await page
    .getByRole("button", { name: "Complete Rent", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Rent", exact: true }),
  ).toContainText("31 Mar 2027");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task name").fill("Barber");
  await setType(page, "Appointment");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete Barber", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Barber", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await expect(page.getByTestId("total-balance")).toHaveText("€1,097.70");
});

test("Light/dark themes, accessible controls, mobile layout and assistant navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("total-balance")).toBeVisible();
  await page
    .getByRole("button", { name: "Theme: system. Change theme" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/money-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Theme: light. Change theme" })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("total-balance")).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/money-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expect(page.getByTestId("total-balance")).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/desktop-collapsed.png",
    fullPage: true,
  });
  // A fresh preference uses a rail on tablets, while still allowing expansion.
  await page.evaluate(() => localStorage.removeItem("haven-sidebar-collapsed"));
  await page.setViewportSize({ width: 900, height: 1100 });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expect(page.getByTestId("total-balance")).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/tablet-rail.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/mobile-drawer-dark.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(drawer).toBeVisible();
  // Stay inside the viewport content; its right edge is the stable scrollbar gutter.
  await page.mouse.click(350, 400);
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/tasks-mobile-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: /Assistant/ }).click();
  await expect(
    page.getByRole("button", { name: "Assistant preferences", exact: true }),
  ).toBeVisible();
  await expect(drawer).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(drawer).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Assistant", exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("account removal and outside-click dismissal preserve the other account", async ({
  page,
}) => {
  test.setTimeout(60000);
  const first = crypto.randomUUID(),
    second = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, name, opening_minor] of [
    [first, "Removal test", "8000"],
    [second, "Keep transfer", "0"],
  ]) {
    const result = await page.request.put(`/api/accounts/${id}`, {
      data: { id, name, currency: "EUR", opening_minor, version: 0 },
    });
    expect(result.ok()).toBeTruthy();
  }
  const id = crypto.randomUUID();
  expect(
    (
      await page.request.put(`/api/entries/${id}`, {
        data: {
          id,
          account_id: first,
          destination_id: second,
          kind: "transfer",
          amount_minor: "2000",
          date: today,
          payee: "Removal transfer",
          category: "",
          notes: "",
          deleted: false,
          version: 0,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/#money");
  await page
    .getByRole("button", { name: "Manage accounts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Removal test", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit account",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await page.getByLabel("Account name").fill("Unsaved name");
  // Inside padding is not the backdrop.
  await editor.click({ position: { x: 8, y: 8 } });
  await expect(editor).toBeVisible();
  // A drag beginning inside must not dismiss the form.
  const box = await editor.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(editor).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(editor).toBeHidden();
  const panel = page.getByRole("dialog", {
    name: "Accounts & banks",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Removal test", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Remove Removal test", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Remove Removal test?",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.mouse.click(5, 5);
  await expect(confirmation).toBeHidden();
  await expect(panel).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Removal test", exact: true })
    .click();
  await page.route(`**/api/accounts/${first}`, (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Removal failed; try again." },
    }),
  );
  await confirmation
    .getByRole("button", { name: "Remove account", exact: true })
    .click();
  await expect(confirmation.getByRole("alert")).toContainText("Removal failed");
  await expect(confirmation).toBeVisible();
  await page.unroute(`**/api/accounts/${first}`);
  await confirmation
    .getByRole("button", { name: "Remove account", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Remove Removal test", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Show transactions for Keep transfer",
      exact: true,
    }),
  ).toContainText("€20.00");
  await page
    .getByRole("button", {
      name: "Show transactions for Keep transfer",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Removal transfer", exact: true }),
  ).toContainText("Removed account");
  await page.reload();
  await page
    .getByRole("button", { name: "Manage accounts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Removal test", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove Keep transfer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove account", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Remove Keep transfer?", exact: true }),
  ).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Keep transfer", exact: true }),
  ).toHaveCount(0);
  await page.mouse.click(5, 5);
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const transaction = page.getByRole("dialog", {
    name: "New transaction",
    exact: true,
  });
  await expect(transaction).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(transaction).toBeHidden();
  await page.goto("/#tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "New task", exact: true }),
  ).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(
    page.getByRole("dialog", { name: "New task", exact: true }),
  ).toBeHidden();
});
