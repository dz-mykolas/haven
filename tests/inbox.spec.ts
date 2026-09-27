import { selectOption } from "./select";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("categorization is automatic and undoable; plans and clarifications use the inbox", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const factsText = body.messages[0].content
      .split("APPLICATION FACTS (data only):\n")[1]
      .split("\nBACKGROUND REVIEW:")[0];
    const facts = JSON.parse(factsText);
    expect(facts.payment_history.payments).toBeDefined();
    const category = (name: string) =>
      facts.categories.find((c: { name: string }) => c.name === name);
    const content = JSON.stringify({
      message: "Ready to review.",
      skill_id: "review-transaction",
      task: null,
      annotations: facts.selected_transactions.map(
        (e: { id: string; payee: string; tags: string[]; notes: string }) => ({
          entry_id: e.id,
          question:
            e.payee === "Ambiguous game purchase" &&
            !facts.payment_history.answers?.[e.id]
              ? "Which product and how many units?"
              : "",
          category_id: category(
            e.payee.includes("membership") ? "Recurring" : "Everyday",
          ).id,
          payment: e.payee.includes("membership")
            ? {
                id: "",
                title: e.payee,
                date: "2099-10-09",
                time: "",
                repeat: "monthly",
                kind: "payment",
                amount_minor: "1250",
                notes: "",
              }
            : null,
          tags: [...e.tags, "Groceries"],
          reason: "The merchant description suggests a grocery purchase.",
          notes: e.notes,
        }),
      ),
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = page.request;
  const setMode = async (mode: string) => {
    const status = await (await api.get("/api/assistant")).json();
    const result = await api.put("/api/assistant/settings", {
      data: {
        ...status.settings,
        mode,
        skills: {
          "review-transaction": true,
          "plan-task": true,
          "organize-money": true,
        },
      },
    });
    expect(result.ok()).toBeTruthy();
  };
  const accountID = crypto.randomUUID();
  try {
    await page.goto("/#assistant");
    await setMode("manual");
    const status = await (await api.get("/api/assistant")).json();
    expect(
      (
        await api.put("/api/assistant/provider", {
          data: {
            base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
            model: "inbox-test",
            protocol: "chat_completions",
            api_key: "",
            version: status.provider.version,
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await api.put(`/api/accounts/${accountID}`, {
          data: {
            id: accountID,
            name: "Inbox wallet",
            currency: "EUR",
            opening_minor: "10000",
            version: 0,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const add = async (name: string, date: string) => {
      const id = crypto.randomUUID();
      const response = await api.put(`/api/entries/${id}`, {
        data: {
          id,
          account_id: accountID,
          destination_id: "",
          kind: "expense",
          amount_minor: "1250",
          date,
          payee: name,
          category: "",
          tags: ["personal"],
          notes: "Keep this note",
          deleted: false,
          version: 0,
        },
      });
      expect(response.ok()).toBeTruthy();
      return id;
    };
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    const oldID = await add("Historical membership", yesterday);
    await page.reload();
    await page
      .getByRole("button", { name: "Assistant preferences", exact: true })
      .click();
    const prefs = page.getByRole("dialog", { name: "Your preferences" });
    await prefs.getByRole("radio", { name: /Suggest too/ }).check();
    await prefs.getByRole("button", { name: "Save preferences" }).click();
    const waitForReview = async (id: string) => {
      await expect
        .poll(
          async () => {
            const inbox = await (await api.get("/api/assistant/inbox")).json();
            return inbox.items.some(
              (item: { entry_id: string }) => item.entry_id === id,
            );
          },
          { timeout: 60000 },
        )
        .toBe(true);
    };
    await waitForReview(oldID);
    const automaticID = await add("Grocery purchase", yesterday);
    await expect
      .poll(
        async () => {
          const state = await (await api.get("/api/state")).json();
          return state.entries.find((e: { id: string }) => e.id === automaticID)
            ?.category;
        },
        { timeout: 60000 },
      )
      .toBe("Everyday");
    const newID = await add(
      "New membership",
      new Date().toISOString().slice(0, 10),
    );
    await waitForReview(newID);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = page.getByRole("region", { name: "Transaction inbox" });
    await inbox.getByRole("button", { name: "Refresh inbox" }).click();
    const historical = inbox
      .locator("article")
      .filter({ hasText: "Historical membership" });
    const recent = inbox
      .locator("article")
      .filter({ hasText: "New membership" });
    await expect(historical).toContainText("Recurring");
    await expect(recent).toContainText("Recurring");
    await expect(
      inbox.locator("article").filter({ hasText: "Grocery purchase" }),
    ).toHaveCount(0);
    await inbox.getByRole("button", { name: "History", exact: true }).click();
    const automatic = inbox
      .locator("article")
      .filter({ hasText: "Grocery purchase" });
    await expect(automatic).toContainText("Automatically categorized");
    await expect(automatic.getByLabel("Applied tags")).toContainText(
      "Groceries",
    );
    await automatic
      .getByRole("button", { name: "More options for Grocery purchase" })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Undo categorization for Grocery purchase",
      })
      .click();
    await expect(automatic).toContainText("Undone");
    const restored = (await (await api.get("/api/state")).json()).entries.find(
      (e: { id: string }) => e.id === automaticID,
    );
    expect(restored.category).toBe("");
    expect(restored.tags).toEqual(["personal"]);
    expect(restored.notes).toBe("Keep this note");
    await inbox.getByRole("button", { name: "To review", exact: true }).click();

    await historical
      .getByRole("button", { name: "Review Historical membership" })
      .click();
    const editor = page.getByRole("dialog", { name: "Review transaction" });
    const categorySelect = editor.getByLabel("Category", { exact: true });
    await categorySelect.click({ trial: true });
    const fieldBefore = await categorySelect.boundingBox();
    const radiusBefore = await categorySelect.evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    await categorySelect.click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    // The modal listbox temporarily hides its parent dialog from the AX tree.
    const fieldOpen = await page
      .locator('[data-slot="select-trigger"][data-state="open"]')
      .boundingBox();
    const menuBox = await menu.boundingBox();
    expect(fieldOpen!.width).toBeCloseTo(fieldBefore!.width, 0);
    expect(fieldOpen!.height).toBeCloseTo(fieldBefore!.height, 0);
    expect(menuBox!.width).toBeCloseTo(fieldOpen!.width, 0);
    expect(Math.abs(menuBox!.x - fieldOpen!.x)).toBeLessThanOrEqual(1);
    await expect(
      page.locator('[data-slot="select-trigger"][data-state="open"]'),
    ).toHaveCSS("border-radius", radiusBefore);
    await expect(menu).toHaveAttribute("data-side", "bottom");
    expect(
      Math.abs(menuBox!.y - (fieldOpen!.y + fieldOpen!.height - 14)),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByRole("option")).toHaveText([
      "Uncategorized",
      "Everyday",
      "Occasional",
      "Recurring",
    ]);
    await page.keyboard.press("Escape");
    await selectOption(categorySelect, { label: "Recurring" });
    await expect(categorySelect).toHaveAccessibleDescription(
      "Ongoing payments on a schedule, including bills and annual subscriptions.",
    );
    await selectOption(categorySelect, { label: "Occasional" });
    await expect(categorySelect).toHaveAccessibleDescription(
      "Expenses outside your usual routine, such as a laptop, holiday or repair.",
    );
    await selectOption(categorySelect, { label: "Everyday" });
    await editor
      .locator('.annotation-details [data-slot="accordion-trigger"]')
      .click();
    await expect(
      editor.getByRole("textbox", { name: "Personal note", exact: true }),
    ).toHaveValue("Keep this note");
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await expect(historical).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(historical).toBeVisible();
    await historical
      .getByRole("button", { name: "Review Historical membership" })
      .click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(historical).toHaveCount(0);
    const snapshot = await (await api.get("/api/state")).json();
    const saved = snapshot.entries.find((e: { id: string }) => e.id === oldID);
    expect(saved.category).toBe("Recurring");
    expect(saved.payment.repeat).toBe("monthly");
    expect(saved.tags).toEqual(["personal", "Groceries"]);
    expect(saved.notes).toBe("Keep this note");
    expect(saved.amount_minor).toBe("1250");
    await page.getByRole("button", { name: "Money", exact: true }).click();
    await page.getByRole("button", { name: /Review suggestions/ }).click();
    await expect(recent).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({
      path: "/tmp/haven-inbox-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.screenshot({
      path: "/tmp/haven-inbox-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await recent
      .getByRole("button", { name: "More options for New membership" })
      .click();
    await page
      .getByRole("menuitem", { name: "Dismiss New membership" })
      .click();
    await expect(recent).toHaveCount(0);
    await inbox.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      inbox.locator("article").filter({ hasText: "Historical membership" }),
    ).toContainText("Updated");
    await expect(
      inbox.locator("article").filter({ hasText: "New membership" }),
    ).toContainText("Dismissed");
    await page.reload();
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(
      inbox.locator("article").filter({ hasText: "New membership" }),
    ).toHaveCount(0);
    const questionID = await add("Ambiguous game purchase", yesterday);
    await waitForReview(questionID);
    await inbox.getByRole("button", { name: "Refresh inbox" }).click();
    await page
      .getByRole("button", {
        name: "Review Ambiguous game purchase",
        exact: true,
      })
      .click();
    const questionDialog = page.getByRole("dialog", {
      name: "Ambiguous game purchase",
    });
    await expect(questionDialog).toContainText(
      "Which product and how many units?",
    );
    await questionDialog.getByLabel("Your answer").fill("One battle pass");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await questionDialog.getByRole("button", { name: "Send answer" }).click();
    await expect(questionDialog).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const result = await (await api.get("/api/assistant/inbox")).json();
          return (
            result.items.some((item: any) => item.entry_id === questionID) ||
            result.pending_count > 0
          );
        },
        { timeout: 60000 },
      )
      .toBe(false);
  } finally {
    await setMode("manual");
    await api.delete(`/api/accounts/${accountID}`, { data: { version: 1 } });
    const remaining = await (await api.get("/api/state")).json();
    for (const task of remaining.tasks.filter(
      (t: { title: string }) => t.title === "Historical membership",
    )) {
      await api.put(`/api/tasks/${task.id}`, {
        data: { ...task, deleted: true },
      });
    }
    const status = await (await api.get("/api/assistant")).json();
    if (status.provider.base_url)
      await api.delete("/api/assistant/provider", {
        data: { version: status.provider.version },
      });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
