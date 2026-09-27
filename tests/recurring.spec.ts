import { selectOption } from "./select";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("manual and LLM recurring payments save the same schedules in Tasks and Upcoming", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const nextDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const facts = JSON.parse(
      body.messages[0].content
        .split("APPLICATION FACTS (data only):\n")[1]
        .split("\nBACKGROUND REVIEW:")[0],
    );
    const recurring = facts.categories.find((c: any) => c.name === "Recurring");
    const content = JSON.stringify({
      message: "Review the next payment.",
      skill_id: "review-transaction",
      task: null,
      annotations: facts.selected_transactions.map((e: any) => ({
        entry_id: e.id,
        category_id: recurring.id,
        tags: e.tags ?? [],
        notes: e.notes,
        reason: "The supplied history suggests a monthly subscription.",
        payment: {
          id: "",
          title: e.payee,
          date: nextDate,
          time: "",
          repeat: "monthly",
          kind: "payment",
          amount_minor: e.amount_minor,
          notes: "",
        },
      })),
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
  const accountID = crypto.randomUUID();
  const state = async () => (await api.get("/api/state")).json();
  const setMode = async (mode: string) => {
    const current = await (await api.get("/api/assistant")).json();
    expect(
      (
        await api.put("/api/assistant/settings", {
          data: { ...current.settings, mode },
        })
      ).ok(),
    ).toBeTruthy();
  };
  const add = async (payee: string) => {
    const id = crypto.randomUUID();
    expect(
      (
        await api.put(`/api/entries/${id}`, {
          data: {
            id,
            account_id: accountID,
            destination_id: "",
            kind: "expense",
            amount_minor: "1599",
            date: new Date().toISOString().slice(0, 10),
            payee,
            category: "",
            tags: [],
            notes: "Keep my receipt",
            deleted: false,
            version: 0,
          },
        })
      ).ok(),
    ).toBeTruthy();
    return id;
  };
  try {
    await page.goto("/#money");
    await setMode("manual");
    expect(
      (
        await api.put(`/api/accounts/${accountID}`, {
          data: {
            id: accountID,
            name: "Recurring wallet",
            currency: "EUR",
            opening_minor: "10000",
            version: 0,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const manualID = await add("Telia schedule test");
    await page.reload();
    await page
      .getByRole("button", { name: "Edit Telia schedule test", exact: true })
      .click();
    let editor = page.getByRole("dialog");
    await selectOption(editor.getByLabel("Category", { exact: true }), {
      label: "Recurring",
    });
    await expect(editor.getByLabel("Next expected payment")).toHaveValue("");
    await editor.getByLabel("Next expected payment").fill(nextDate);
    await selectOption(editor.getByLabel("Payment frequency"), "monthly");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    let snapshot = await state();
    const manual = snapshot.entries.find((e: any) => e.id === manualID);
    expect(manual.payment.repeat).toBe("monthly");
    expect(snapshot.tasks.some((t: any) => t.id === manual.payment.id)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Show money details" }).click();
    await expect(
      page.getByRole("region", { name: "Upcoming costs" }),
    ).toContainText("Telia schedule test");

    const llmID = await add("Netflix schedule test");
    const current = await (await api.get("/api/assistant")).json();
    expect(
      (
        await api.put("/api/assistant/provider", {
          data: {
            base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
            model: "recurring-test",
            protocol: "chat_completions",
            api_key: "",
            version: current.provider.version,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await setMode("proactive");
    const review = async (id: string) => {
      await expect
        .poll(
          async () => {
            const inbox = await (await api.get("/api/assistant/inbox")).json();
            return inbox.items.some(
              (item: any) => item.entry_id === id && item.draft.payment,
            );
          },
          { timeout: 60000 },
        )
        .toBe(true);
      await page.goto("/#assistant");
      await page.getByRole("button", { name: /^Inbox/ }).click();
      await page.getByRole("button", { name: "Refresh inbox" }).click();
      await page
        .getByRole("button", {
          name: "Review Netflix schedule test",
          exact: true,
        })
        .click();
    };
    await review(llmID);
    editor = page.getByRole("dialog", { name: "Review transaction" });
    // Sample rendered heights: a named animation alone can still snap open.
    const explanation = editor.locator(".bank-description");
    await expect(
      explanation.getByRole("button", { name: "Why this suggestion" }),
    ).toBeVisible();
    for (const opening of [true, false]) {
      const heights = await explanation.evaluate(async (el) => {
        const content = el.querySelector<HTMLElement>(
          '[data-slot="accordion-content"]',
        )!;
        const samples = [content.getBoundingClientRect().height];
        el.querySelector<HTMLButtonElement>("button")!.click();
        const start = performance.now();
        let transition: Animation | undefined;
        await new Promise<void>((resolve) => {
          const sample = () => {
            transition = content
              .getAnimations({ subtree: true })
              .find(
                (animation) =>
                  animation instanceof CSSTransition &&
                  animation.transitionProperty === "grid-template-rows",
              );
            if (!transition && performance.now() - start < 400)
              requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        if (!transition)
          throw new Error("Disclosure height transition did not start");
        // Seek the real transition so CPU load cannot reduce the sampled frames.
        transition.pause();
        const duration = Number(transition.effect!.getTiming().duration);
        for (const progress of [0.2, 0.4, 0.6, 1]) {
          transition.currentTime = duration * progress;
          samples.push(content.getBoundingClientRect().height);
        }
        transition.finish();
        return samples;
      });
      const collapsed = opening ? heights[0] : heights.at(-1)!;
      const expanded = opening ? heights.at(-1)! : heights[0];
      expect(collapsed).toBe(0);
      expect(expanded).toBeGreaterThan(20);
      expect(
        heights.filter((height) => height > 1 && height < expanded - 1).length,
      ).toBeGreaterThan(2);
    }
    await expect(editor.getByLabel("Next expected payment")).toBeHidden();
    const scheduleDetails = editor.getByRole("button", {
      name: "Edit payment schedule",
    });
    await expect(scheduleDetails).toContainText("€15.99 · Monthly");
    await scheduleDetails.click();
    await expect(editor.getByLabel("Next expected payment")).toHaveValue(
      nextDate,
    );
    await expect(editor.getByLabel("Payment frequency")).toHaveText("Monthly");
    await expect(editor.getByLabel("Expected amount · EUR")).toHaveValue(
      "15.99",
    );
    await editor.getByLabel("Expected amount · EUR").fill("16.49");
    await scheduleDetails.click();
    await expect(scheduleDetails).toContainText("€16.49 · Monthly");
    await expect(editor.getByLabel("Expected amount · EUR")).toBeHidden();
    await scheduleDetails.click();
    await expect(editor.getByLabel("Expected amount · EUR")).toHaveValue(
      "16.49",
    );
    await editor.getByLabel("Expected amount · EUR").fill("15.99");
    const scheduling = editor.getByRole("switch", {
      name: "Schedule future payments",
    });
    await scheduling.uncheck();
    await expect(editor.getByLabel("Next expected payment")).toBeHidden();
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
    await scheduling.check();
    await expect(editor.getByLabel("Next expected payment")).toHaveValue(
      nextDate,
    );
    await editor
      .getByRole("button", { name: "Open calendar for payment-date" })
      .click();
    await expect(page.getByRole("grid")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      editor.getByRole("button", { name: "Open calendar for payment-date" }),
    ).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(
      editor.locator('.annotation-details [data-slot="accordion-trigger"]'),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      editor.locator('.bank-description [data-slot="accordion-trigger"]'),
    ).toHaveAttribute("aria-expanded", "false");
    const viewport = editor.getByRole("region", {
      name: "Transaction details",
      exact: true,
    });
    const widthBefore = await viewport.evaluate((el) => el.clientWidth);
    await page.setViewportSize({ width: 390, height: 620 });
    await page.waitForTimeout(350);
    const footerBefore = await editor.locator(".dialog-actions").boundingBox();
    await editor
      .locator('.annotation-details [data-slot="accordion-trigger"]')
      .click();
    await editor.getByLabel("Personal note").fill("A long note\n".repeat(20));
    await editor
      .locator('.bank-description [data-slot="accordion-trigger"]')
      .click();
    expect(await viewport.evaluate((el) => el.clientWidth)).toBe(widthBefore);
    await viewport.focus();
    await viewport.press("End");
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const footerAfter = await editor.locator(".dialog-actions").boundingBox();
    expect(Math.abs(footerAfter!.y - footerBefore!.y)).toBeLessThan(1);
    // The app's overlay scrollbar: its thumb drags the editor back up.
    const thumb = page.locator('.scroll-thumb[data-axis="y"][data-visible]');
    await expect(thumb).toBeVisible();
    const thumbBox = await thumb.boundingBox();
    const railBox = await viewport.boundingBox();
    await page.mouse.move(thumbBox!.x + 2, thumbBox!.y + thumbBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumbBox!.x + 2, railBox!.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeLessThan(2);
    await editor.getByLabel("Personal note").fill("Keep my receipt");
    await editor
      .locator('.annotation-details [data-slot="accordion-trigger"]')
      .click();
    await editor
      .locator('.bank-description [data-slot="accordion-trigger"]')
      .click();
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/haven-recurring-editor.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.waitForTimeout(350);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "/tmp/haven-recurring-editor-dark.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: "/tmp/haven-recurring-editor-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    snapshot = await state();
    const scheduled = snapshot.entries.find((e: any) => e.id === llmID);
    expect(scheduled.payment.repeat).toBe(manual.payment.repeat);
    expect(scheduled.payment.date).toBe(manual.payment.date);
    expect(scheduled.notes).toBe("Keep my receipt");
    expect(
      snapshot.upcoming.items.some(
        (item: any) => item.task.id === scheduled.payment.id,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Edit Netflix schedule test/ }),
    ).toBeVisible();

    const duplicateID = await add("Netflix schedule test");
    await expect
      .poll(
        async () => {
          const next = await state();
          return next.entries.find((e: any) => e.id === duplicateID)?.category;
        },
        { timeout: 60000 },
      )
      .toBe("Recurring");
    const pending = await (await api.get("/api/assistant/inbox")).json();
    expect(
      pending.items.some((item: any) => item.entry_id === duplicateID),
    ).toBe(false);
    snapshot = await state();
    expect(
      snapshot.tasks.filter((t: any) => t.title === "Netflix schedule test"),
    ).toHaveLength(1);
    expect(
      snapshot.entries.find((e: any) => e.id === duplicateID).payment.id,
    ).toBe(scheduled.payment.id);
  } finally {
    await setMode("manual");
    await api.delete(`/api/accounts/${accountID}`, { data: { version: 1 } });
    const snapshot = await state();
    for (const task of snapshot.tasks.filter((t: any) =>
      /schedule test$/.test(t.title),
    )) {
      await api.put(`/api/tasks/${task.id}`, {
        data: { ...task, deleted: true },
      });
    }
    const current = await (await api.get("/api/assistant")).json();
    if (current.provider.base_url)
      await api.delete("/api/assistant/provider", {
        data: { version: current.provider.version },
      });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
