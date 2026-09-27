import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectOption } from "./select";

test("upcoming timeline, details, inclusion and prepaid editing work on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1000, height: 1000 });
  const ids: string[] = [];
  const api = page.request;
  const day = (offset: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius" }).format(
      new Date(Date.now() + offset * 86400000),
    );
  const base = {
    time: "",
    timezone: "Europe/Vilnius",
    repeat: "monthly",
    kind: "payment",
    amount_minor: "1599",
    notes: "",
    done: false,
    deleted: false,
    version: 0,
    estimated_min_minor: null,
    estimated_max_minor: null,
  };
  const plan = {
    kind: "prepaid",
    excluded: false,
    remind: false,
    expires_on: day(8),
    coverage_through: day(0),
    date_until: "",
    interval_days: 0,
    coverage_days: 30,
    quantity: 1,
  };
  const create = async (title: string, extra = {}) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const response = await api.put(`/api/tasks/${id}`, {
      data: { ...base, id, title, date: day(7), ...extra },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return id;
  };
  try {
    await page.goto("/#money");
    const settings = await (await api.get("/api/assistant")).json();
    await api.put("/api/assistant/settings", {
      data: { ...settings.settings, mode: "manual" },
    });
    await create("Netflix chip test");
    await create("Welkin chip test", {
      repeat: "none",
      date: day(8),
      amount_minor: "499",
      plan,
    });
    await create("Battle pass chip test", {
      repeat: "none",
      amount_minor: "999",
      plan: {
        ...plan,
        kind: "expected",
        expires_on: "",
        date_until: day(18),
        interval_days: 40,
      },
    });
    await create("Wuwa future test", {
      repeat: "none",
      date: day(120),
      plan: { ...plan, expires_on: day(120) },
    });
    for (const title of [
      "Telia",
      "Spotify Premium",
      "Gym+",
      "Apple iCloud+",
      "Apartment rent",
      "Ignitis",
      "JUDU",
    ])
      await create(`${title} chip test`);
    await page.reload();
    await page.getByRole("button", { name: "Show money details" }).click();
    // Measure positions once the card has finished expanding.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    const region = page.getByRole("region", { name: "Upcoming costs" });
    const wide = region.locator(".timeline-wide");
    const lanes = region.getByRole("group", { name: "Upcoming plans" });
    // A crowded column shows two payments and "+n"; the rest stay reachable:
    // focusing one opens its column, as pointing at it does.
    await expect(lanes.locator(".pt[data-more] .more")).toHaveText(/^\+\d+$/);
    const reveal = async (name: RegExp) => {
      const mark = region.getByRole("button", { name });
      await mark.focus();
      await expect(wide).toHaveAttribute("data-zoomed", "");
      return mark;
    };
    const netflix = await reveal(/Details for Netflix chip test/);
    await expect(netflix).toBeVisible();
    // Known brands get their logo from Haven's catalogue; others keep the
    // generic icon.
    await expect(netflix.locator(".brand-icon")).toBeVisible();
    await expect(
      region
        .getByRole("button", { name: /Details for Spotify Premium/ })
        .locator(".brand-icon"),
    ).toBeVisible();
    await expect(
      region
        .getByRole("button", { name: /Details for Telia chip test/ })
        .locator(".brand-icon"),
    ).toHaveCount(0);
    // The opened column lays its payments out side by side, inside the line.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    const strip = (await lanes.boundingBox())!;
    const opened = await lanes
      .locator(".pt.focus")
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect()),
      );
    expect(opened.length).toBeGreaterThan(3);
    const xs = opened.map((box) => box.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(20);
    for (const box of opened) {
      expect(box.x).toBeGreaterThanOrEqual(strip.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
    }
    // Leaving it closes it; pointing at a column opens that one.
    await netflix.blur();
    await expect(wide).not.toHaveAttribute("data-zoomed", "");
    await lanes.locator(".pt:not([data-hidden])").last().hover();
    await expect(wide).toHaveAttribute("data-zoomed", "");
    await netflix.focus();
    await netflix.click();
    await expect(page.getByLabel("Netflix chip test details")).toContainText(
      "Scheduled payment",
    );
    await page.keyboard.press("Escape");
    const subtotal = async () =>
      (await (await api.get("/api/state")).json()).upcoming.minimum_minor;
    const before = BigInt(await subtotal());
    const welkin = region.getByRole("button", {
      name: /Details for Welkin chip test/,
    });
    const toggle = page.getByRole("switch", {
      name: "Include Welkin chip test in estimated spending",
    });
    await welkin.focus();
    await welkin.click();
    await toggle.click();
    await expect.poll(subtotal).toBe(String(before - 499n));
    await page.keyboard.press("Escape");
    await expect(welkin).toHaveAttribute("data-excluded", "true");
    await page.reload();
    await page.getByRole("button", { name: "Show money details" }).click();
    await welkin.focus();
    await welkin.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect.poll(subtotal).toBe(String(before));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Manage payment plans" }).click();
    const manager = page.getByRole("dialog", { name: "Payment plans" });
    await expect(
      manager.getByRole("button", { name: "Edit Wuwa future test plan" }),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Edit Wuwa future test plan" })
      .click();
    const editor = page.getByRole("dialog");
    await expect(editor.getByLabel("Plan type")).toHaveText("Prepaid coverage");
    await editor.getByRole("button", { name: "Forecast & coverage" }).click();
    await expect(editor.getByLabel("Show reminder in Tasks")).not.toBeChecked();
    await expect(
      editor.getByLabel("Coverage ends", { exact: true }),
    ).toHaveValue(day(120));
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForTimeout(400);
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/haven-upcoming-desktop.png",
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await region.scrollIntoViewIfNeeded();
    await region
      .getByRole("button", { name: /Details for Welkin chip test/ })
      .click();
    const details = page.getByLabel("Welkin chip test details");
    await expect(details).toContainText("Expires in 8 days");
    await expect(details).toHaveCSS("opacity", "1");
    const bounds = (await details.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "/tmp/haven-upcoming-mobile.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    // A new prepaid plan can save with unknown timing rather than inventing today's due date.
    await page.getByRole("button", { name: "Add upcoming payment" }).click();
    await editor.getByLabel("What’s the plan?").fill("Unknown prepaid test");
    await selectOption(editor.getByLabel("Plan type"), "prepaid");
    await expect(editor.getByLabel("Date", { exact: true })).toHaveValue("");
    await editor.getByLabel("Expected amount · EUR").fill("4.99");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const snapshot = await (await api.get("/api/state")).json();
    const unknown = snapshot.tasks.find(
      (task: any) => task.title === "Unknown prepaid test",
    );
    ids.push(unknown.id);
    expect(unknown.date).toBe("");
    expect(
      snapshot.upcoming.items.some(
        (item: any) => item.task.id === unknown.id && item.date === "",
      ),
    ).toBe(true);
    await page.goto("/#tasks");
    await expect(
      page.getByRole("button", { name: /Edit Unknown prepaid test/ }),
    ).toHaveCount(0);
  } finally {
    const snapshot = await (await api.get("/api/state")).json();
    for (const task of snapshot.tasks.filter((task: any) =>
      ids.includes(task.id),
    ))
      await api.put(`/api/tasks/${task.id}`, {
        data: { ...task, deleted: true },
      });
  }
});
