import { setTime, setType } from "./task-editor";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("calendar navigation, recurring previews, completion history and selected-day creation", async ({
  page,
}) => {
  test.setTimeout(60000);
  const taskID = crypto.randomUUID();
  expect(
    (
      await page.request.put(`/api/tasks/${taskID}`, {
        data: {
          id: taskID,
          title: "Calendar vitamins",
          date: "2028-01-31",
          time: "08:00",
          timezone: "Europe/Vilnius",
          repeat: "monthly",
          anchor_day: 31,
          kind: "task",
          amount_minor: "0",
          notes: "",
          done: false,
          deleted: false,
          version: 0,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/#tasks");
  await expect(
    page.getByRole("region", { name: "Task list", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Task calendar", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Calendar month", { exact: true }).fill("2028-02");
  const day = (date: string) =>
    page.locator(`.calendar-day[data-date="${date}"]`);
  await expect(day("2028-02-29")).toHaveAccessibleName(/1 item$/);
  await day("2028-02-29").click();
  const agenda = page.getByRole("region", {
    name: "Selected day",
    exact: true,
  });
  await expect(agenda).toContainText("Calendar vitamins");
  await expect(agenda).toContainText("Future repeat");
  await expect(
    agenda.getByRole("button", {
      name: "Complete Calendar vitamins",
      exact: true,
    }),
  ).toHaveCount(0);
  await day("2028-01-31").click();
  await agenda
    .getByRole("button", { name: "Complete Calendar vitamins", exact: true })
    .click();
  await expect(agenda).toContainText("Completed");
  await page.getByLabel("Calendar month", { exact: true }).fill("2028-02");
  await day("2028-02-29").click();
  await expect(
    agenda.getByRole("button", {
      name: "Complete Calendar vitamins",
      exact: true,
    }),
  ).toBeVisible();
  await day("2028-02-29").press("ArrowRight");
  await expect(page.getByLabel("Calendar month", { exact: true })).toHaveValue(
    "2028-03",
  );
  await expect(day("2028-03-01")).toBeFocused();
  await page
    .getByRole("button", { name: "Add task on selected day", exact: true })
    .click();
  await page.getByRole("button", { name: /^Date:/ }).click();
  await expect(page.getByLabel("Pick a date", { exact: true })).toHaveValue(
    "2028-03-01",
  );
  await page.getByLabel("Task name").fill("Calendar haircut");
  await setType(page, "Appointment");
  await setTime(page, "16:30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(agenda).toContainText("Calendar haircut");
  await expect(agenda).toContainText("16:30");
  await page.getByLabel("Search tasks", { exact: true }).fill("does not match");
  await expect(agenda).toContainText("No matching tasks");
  await page.getByLabel("Search tasks", { exact: true }).fill("");
  for (const [width, height, theme] of [
    [1440, 1000, "light"],
    [820, 1180, "light"],
    [390, 844, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (width >= 820) {
      const calendar = await page
        .getByRole("region", { name: "Task calendar", exact: true })
        .boundingBox();
      const list = await agenda.boundingBox();
      expect(calendar!.x).toBeGreaterThanOrEqual(list!.x + list!.width);
      expect(Math.abs(calendar!.y - list!.y)).toBeLessThan(2);
    }
    await page.screenshot({
      path: `.local/test-results/calendar-${width}.png`,
      fullPage: true,
    });
  }
  await expect(
    page.getByRole("button", { name: "Show month", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(day("2028-03-15")).toBeHidden();
  await page.getByRole("button", { name: "Show month", exact: true }).click();
  await expect(day("2028-03-15")).toBeVisible();
  await day("2028-03-15").click();
  await page.getByRole("button", { name: "Show week", exact: true }).click();
  await expect(day("2028-03-15")).toBeVisible();
  await expect(day("2028-03-01")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Task calendar", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Calendar month", { exact: true }).fill("2028-03");
  await day("2028-03-01").click();
  await agenda
    .getByRole("button", { name: "Edit Calendar haircut", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(agenda).toContainText("Nothing planned");
  // Keep the shared browser-test database clean for the existing workflows.
  const tasks = (await (await page.request.get("/api/state")).json()).tasks;
  const task = tasks.find((t: { id: string }) => t.id === taskID);
  expect(
    (
      await page.request.put(`/api/tasks/${taskID}`, {
        data: { ...task, deleted: true },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Upcoming", exact: true }),
  ).toBeVisible();
});

test("unified task workspace, populated layouts, motion preferences and calendar recovery", async ({
  page,
}) => {
  test.setTimeout(60000);
  const definitions = [
    {
      title: "Morning vitamins",
      date: "2028-03-01",
      time: "08:00",
      repeat: "daily",
      kind: "task",
    },
    {
      title: "Haircut at the barber",
      date: "2028-03-01",
      time: "16:30",
      kind: "appointment",
    },
    {
      title: "Pay apartment rent",
      date: "2028-03-02",
      repeat: "monthly",
      kind: "payment",
      amount_minor: "65000",
    },
    {
      title: "Netflix",
      date: "2028-03-03",
      repeat: "monthly",
      kind: "payment",
      amount_minor: "999",
    },
    { title: "Book a dental check-up", date: "2028-03-04", kind: "task" },
    {
      title: "Return the parcel",
      date: "2028-03-01",
      kind: "task",
      done: true,
    },
  ];
  const ids: string[] = [];
  for (const definition of definitions) {
    const id = crypto.randomUUID();
    ids.push(id);
    expect(
      (
        await page.request.put(`/api/tasks/${id}`, {
          data: {
            id,
            time: "",
            timezone: "Europe/Vilnius",
            repeat: "none",
            anchor_day: Number(definition.date.slice(8)),
            amount_minor: "0",
            notes: "",
            done: false,
            deleted: false,
            version: 0,
            ...definition,
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    (window as any).taskMotions = [];
    Element.prototype.animate = function (...args) {
      // Rows, or whole days that slide in with their rows.
      if (
        this.hasAttribute("data-task-key") ||
        this.hasAttribute("data-motion-key")
      )
        (window as any).taskMotions.push(
          this.getAttribute("data-task-key") ??
            this.getAttribute("data-motion-key"),
        );
      return animate.apply(this, args);
    };
  });
  await page.route("**/api/tasks/calendar?*", (route) => route.abort(), {
    times: 1,
  });
  await page.goto("/#tasks");
  await expect(
    page.getByRole("button", { name: "Retry calendar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Morning vitamins", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry calendar" }).click();
  await expect(
    page.getByRole("button", { name: "Retry calendar" }),
  ).toHaveCount(0);
  await page.getByLabel("Calendar month", { exact: true }).fill("2028-03");
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  const list = page.getByRole("region", { name: "Task list", exact: true });
  await expect(list.locator(".tl-row")).toHaveCount(5);
  for (const [width, height, theme] of [
    [1440, 1000, "light"],
    [1440, 1000, "dark"],
    [820, 1180, "light"],
    [390, 844, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      window.scrollTo(0, 0);
    }, theme);
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const search = await page
      .getByLabel("Search tasks", { exact: true })
      .boundingBox();
    expect(search!.width).toBeGreaterThan(150);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/test-results/task-workspace-${width}-${theme}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    (window as any).taskMotions = [];
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Return the parcel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upcoming", exact: true }).click();
  expect(await page.evaluate(() => (window as any).taskMotions)).toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page
    .getByRole("button", { name: "Complete Morning vitamins", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: /2 March 2028/ })
      .getByRole("button", { name: "Edit Morning vitamins", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).taskMotions.length))
    .toBeGreaterThan(0);
  // Leave the shared test database as it was before this UI fixture.
  const tasks = (await (await page.request.get("/api/state")).json()).tasks;
  for (const task of tasks.filter((task: { id: string }) =>
    ids.includes(task.id),
  )) {
    expect(
      (
        await page.request.put(`/api/tasks/${task.id}`, {
          data: { ...task, deleted: true },
        })
      ).ok(),
    ).toBeTruthy();
  }
});
