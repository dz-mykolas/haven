import { selectOption } from "./select";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const shots = process.env.HAVEN_SHOTS;

test("notes drive assistant follow-ups: readback, routine, Inbox notice and undo", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(20000);
  const day = (offset: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius" }).format(
      new Date(Date.now() + offset * 86400000),
    );
  const phases: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const facts = JSON.parse(
      JSON.parse(raw).messages[0].content.split(
        "APPLICATION FACTS (data only):\n",
      )[1],
    );
    phases.push(`${facts.task.title}:${facts.phase}`);
    const reply: Record<string, unknown> = {
      summary: "",
      check_on: "",
      action: "none",
      message: "",
      question: "",
      task: null,
    };
    if (facts.task.title === "Vitamin D3") {
      reply.summary = "Ends in a month · then 2000 IU daily";
      reply.check_on = day(29);
    } else if (facts.phase === "saved") {
      reply.summary = "When done · remind you to update your SEB address";
      reply.check_on = day(10);
    } else {
      reply.action = "replace";
      reply.message = "Added a task to update your address at SEB";
      reply.task = {
        id: "",
        title: "Update address at SEB",
        date: day(1),
        time: "",
        repeat: "none",
        kind: "task",
        amount_minor: "0",
        estimated_min_minor: null,
        estimated_max_minor: null,
        notes: "",
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(reply) },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = page.request;
  const setMode = async (mode: string) => {
    const status = await (await api.get("/api/assistant")).json();
    const result = await api.put("/api/assistant/settings", {
      data: { ...status.settings, mode },
    });
    expect(result.ok()).toBeTruthy();
  };
  const titles = ["Vitamin D3", "Renew passport", "Update address at SEB"];
  try {
    await page.goto("/#tasks");
    const status = await (await api.get("/api/assistant")).json();
    expect(
      (
        await api.put("/api/assistant/provider", {
          data: {
            base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
            model: "followup-test",
            protocol: "chat_completions",
            api_key: "",
            version: status.provider.version,
          },
        })
      ).ok(),
    ).toBeTruthy();
    await setMode("on_request");

    // A routine with instructions in its notes gets a one-line readback.
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("What’s the plan?").fill("Vitamin D3");
    await selectOption(
      page.getByRole("combobox", { name: "Repeat", exact: true }),
      "daily",
    );
    await page.getByRole("button", { name: "Routine" }).click();
    await page
      .getByLabel("Notes", { exact: true })
      .fill("4000 IU for a month, then 2000 IU daily");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const vitamin = page.getByRole("button", {
      name: "Edit Vitamin D3",
      exact: true,
    });
    await expect(vitamin).toContainText("daily routine");
    await expect(vitamin).toContainText("Ends in a month · then 2000 IU daily");
    await vitamin.click();
    await expect(page.locator(".follow-up-line")).toHaveText(
      "Ends in a month · then 2000 IU daily",
    );
    await expect(page.getByRole("button", { name: "Routine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (shots) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${shots}-editor.png` });
    }
    await page.keyboard.press("Escape");

    // Completing a one-off task lets its notes say what comes next.
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("What’s the plan?").fill("Renew passport");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("After this, remind me to update my address at SEB");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit Renew passport", exact: true }),
    ).toContainText("When done");
    if (shots) await page.screenshot({ path: `${shots}-tasks.png` });
    await page
      .getByRole("button", { name: "Complete Renew passport", exact: true })
      .click();
    await page.goto("/#assistant");
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(
      page.getByText("Added a task to update your address at SEB"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Inbox/ })).toContainText(
      "1",
    );
    if (shots) await page.screenshot({ path: `${shots}-inbox.png` });
    expect(phases).toContain("Renew passport:check");

    // Undo removes the task the assistant added.
    let state = await (await api.get("/api/state")).json();
    expect(
      state.tasks.find((t: any) => t.title === "Update address at SEB")
        ?.continues_from,
    ).toBeTruthy();
    await page
      .getByRole("button", { name: "Undo change to Renew passport" })
      .click();
    await expect(
      page.getByRole("button", { name: "Undo change to Renew passport" }),
    ).toHaveCount(0);
    state = await (await api.get("/api/state")).json();
    expect(
      state.tasks.some((t: any) => t.title === "Update address at SEB"),
    ).toBe(false);
  } finally {
    await setMode("manual");
    const remaining = await (await api.get("/api/state")).json();
    for (const task of remaining.tasks.filter((t: { title: string }) =>
      titles.includes(t.title),
    ))
      await api.put(`/api/tasks/${task.id}`, {
        data: { ...task, deleted: true },
      });
    const status = await (await api.get("/api/assistant")).json();
    if (status.provider.base_url)
      await api.delete("/api/assistant/provider", {
        data: { version: status.provider.version },
      });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
