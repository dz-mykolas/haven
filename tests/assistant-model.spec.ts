import { setMoney, setRepeat } from "./task-editor";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("model setup, real compatible HTTP request, draft review and manual controls", async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  let calls = 0;
  let authorized = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls++;
    authorized = req.headers.authorization === "Bearer browser-test-key";
    const followUp =
      body.messages.at(-1).content === "It will cost 60–70 euros";
    const previous = followUp
      ? JSON.parse(body.messages.at(-2).content).task
      : null;
    const content = body.messages[0].content.includes("connection test")
      ? "OK"
      : JSON.stringify({
          message: followUp
            ? "Ready to review."
            : "Review your haircut appointment.",
          skill_id: "plan-task",
          task: {
            id: previous?.id || "",
            title: "Haircut from chat",
            date: new Date(Date.now() + 9 * 86400000)
              .toISOString()
              .slice(0, 10),
            time: "16:30",
            repeat: "none",
            kind: "appointment",
            amount_minor: "0",
            estimated_min_minor: followUp ? "6000" : null,
            estimated_max_minor: followUp ? "7000" : null,
            notes: "",
          },
          annotations: [],
        });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto("/#assistant");
    await page
      .getByRole("button", { name: "Assistant preferences", exact: true })
      .click();
    const prefs = page.getByRole("dialog", {
      name: "Your preferences",
      exact: true,
    });
    await prefs.getByRole("button", { name: "Set up", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "Model connection",
      exact: true,
    });
    await editor
      .getByLabel("API base URL", { exact: true })
      .fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
    await editor.getByLabel("Model ID", { exact: true }).fill("test-model");
    await editor
      .getByLabel("Model API key", { exact: true })
      .fill("browser-test-key");
    await expect(editor.getByLabel("API format", { exact: true })).toBeHidden();
    await editor
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(
      prefs.getByRole("button", { name: "Test connection", exact: true }),
    ).toBeDisabled();
    expect(calls).toBe(0);
    await prefs.getByRole("radio", { name: /When I ask/ }).check();
    await prefs
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Assistant preferences", exact: true })
      .click();
    await prefs
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      prefs.getByText("Connection tested", { exact: true }),
    ).toBeVisible();
    expect(calls).toBe(1);
    expect(authorized).toBe(true);
    await prefs
      .getByRole("button", { name: "Edit connection", exact: true })
      .click();
    await expect(
      editor.getByLabel("Model API key", { exact: true }),
    ).toHaveValue("");
    await expect(
      editor.getByLabel("Model API key", { exact: true }),
    ).toHaveAttribute("placeholder", "Saved key · leave blank to keep");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.waitForTimeout(400);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "test-results/model-setup-mobile.png",
      fullPage: true,
    });
    await editor
      .getByRole("button", { name: "Close model connection", exact: true })
      .click();
    await prefs
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await page
      .getByLabel("Message Haven", { exact: true })
      .fill("Barber next Friday at 16:30");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const chat = page.getByRole("region", { name: "Assistant chat" });
    await expect(
      chat.getByText("Review your haircut appointment.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Message Haven", { exact: true })
      .fill("It will cost 60–70 euros");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      chat.getByText("Ready to review.", {
        exact: true,
      }),
    ).toBeVisible();
    const revisedCard = chat.getByRole("button", {
      name: "Review task: Haircut from chat",
      exact: true,
    });
    await expect(revisedCard).toHaveCount(1);
    await expect(revisedCard).toContainText("Est. €60.00–€70.00");
    await expect(chat.getByRole("alert")).toHaveCount(0);
    const before = await (await page.request.get("/api/state")).json();
    expect(
      before.tasks.some(
        (t: { title: string }) => t.title === "Haircut from chat",
      ),
    ).toBe(false);
    for (const [width, height, theme] of [
      [390, 844, "dark"],
      [1280, 1000, "light"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.waitForTimeout(400);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/assistant-chat-${width}.png`,
        fullPage: true,
      });
    }
    await chat
      .getByRole("button", {
        name: "Review task: Haircut from chat",
        exact: true,
      })
      .getByText("Haircut from chat", { exact: true })
      .click();
    const task = page.getByRole("dialog");
    await expect(task.getByLabel("Task name", { exact: true })).toHaveValue(
      "Haircut from chat",
    );
    await expect(
      task.getByRole("button", { name: "Money: −60.00–70.00", exact: true }),
    ).toBeVisible();
    await expect(
      task.getByRole("button", { name: "Type: Appointment", exact: true }),
    ).toBeVisible();
    await task.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      chat.getByRole("button", {
        name: "Task saved: Haircut from chat",
        exact: true,
      }),
    ).toBeDisabled();
    const after = await (await page.request.get("/api/state")).json();
    const created = after.tasks.find(
      (t: { title: string }) => t.title === "Haircut from chat",
    );
    expect(created.time).toBe("16:30");
    expect(created.kind).toBe("appointment");
    expect(created.amount_minor).toBe("0");
    expect(created.notes).toBe("");
    expect(created.estimated_min_minor).toBe("6000");
    expect(created.estimated_max_minor).toBe("7000");
    await page.getByRole("button", { name: "Money", exact: true }).click();
    await page.getByRole("button", { name: "Show money details" }).click();
    const upcoming = page.getByRole("region", {
      name: "Upcoming costs",
      exact: true,
    });
    await expect(upcoming).toContainText("Haircut from chat");
    await expect(page.getByTestId("upcoming-total")).toHaveText(
      "€60.00–€70.00",
    );
    await expect(page.getByTestId("spending-total")).toHaveText("€0.00");
    await page
      .getByRole("button", { name: "Add upcoming payment", exact: true })
      .click();
    await page.getByLabel("Task name", { exact: true }).fill("Netflix");
    await setMoney(page, "13.99");
    await setRepeat(page, "Monthly");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(upcoming).toContainText("Netflix");
    await upcoming
      .getByRole("button", { name: /^Details for Netflix,/ })
      .click();
    await expect(page.getByLabel("Netflix details")).toContainText("monthly");
    await page.keyboard.press("Escape");
    const withSubscription = await (
      await page.request.get("/api/state")
    ).json();
    const subscription = withSubscription.tasks.find(
      (t: { title: string }) => t.title === "Netflix",
    );
    expect(subscription.estimated_min_minor).toBe("1399");
    for (const [width, height, theme] of [
      [1280, 1000, "light"],
      [390, 844, "dark"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.waitForTimeout(400);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/upcoming-${width}.png`,
        fullPage: true,
      });
    }
    await page.request.put(`/api/tasks/${subscription.id}`, {
      data: { ...subscription, deleted: true },
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/#assistant");
    await page.request.put(`/api/tasks/${created.id}`, {
      data: { ...created, deleted: true },
    });
    await page
      .getByRole("button", { name: "Assistant preferences", exact: true })
      .click();
    await prefs.getByRole("radio", { name: /Manual only/ }).check();
    await prefs
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(page.getByLabel("Message Haven", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Assistant preferences", exact: true })
      .click();
    await prefs
      .getByRole("button", { name: "Remove model connection", exact: true })
      .click();
    await expect(
      prefs.getByRole("button", { name: "Set up", exact: true }),
    ).toBeVisible();
    expect(calls).toBe(3);
  } finally {
    const status = await (await page.request.get("/api/assistant")).json();
    if (status.provider.base_url)
      await page.request.delete("/api/assistant/provider", {
        data: { version: status.provider.version },
      });
    if (status.settings.mode !== "manual")
      await page.request.put("/api/assistant/settings", {
        data: { ...status.settings, mode: "manual" },
      });
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
