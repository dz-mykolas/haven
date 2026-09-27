import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { addTag, setRepeat } from "./task-editor";

const shots = process.env.HAVEN_SHOTS;

test("notes drive assistant suggestions that wait for approval in When I ask mode", async ({
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
    const task = facts.task;
    phases.push(`${task.title}:${facts.phase}`);
    const reply: Record<string, unknown> = {
      summary: "",
      check_on: "",
      action: "none",
      message: "",
      question: "",
      task: null,
    };
    if (task.title === "Vitamin D3" && facts.phase === "saved" && !task.until) {
      // The notes say how long: suggest the end date.
      reply.summary = "4000 IU for two months, then 2000 IU daily";
      reply.check_on = day(58);
      reply.action = "update";
      reply.message = "Daily 4000 IU ends after two months";
      reply.task = {
        id: task.id,
        title: task.title,
        date: task.date,
        time: task.time,
        repeat: task.repeat,
        kind: task.kind,
        amount_minor: "0",
        estimated_min_minor: null,
        estimated_max_minor: null,
        notes: task.notes,
        tags: task.tags,
        every: task.every,
        weekdays: task.weekdays,
        until: day(59),
        income: false,
      };
    } else if (task.title === "Vitamin D3") {
      reply.summary = "Switch to 2000 IU when this ends";
      reply.check_on = day(58);
    } else if (facts.phase === "saved") {
      reply.summary = "When done, remind about the SEB address";
      reply.check_on = day(10);
    } else {
      reply.action = "replace";
      reply.message = "Add a task to update your address at SEB";
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

    // A daily habit that skips missed days, with its plan in the notes.
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Task name").fill("Vitamin D3");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("4000 IU daily for about 2 months, then 2000 IU daily");
    await setRepeat(page, "Daily");
    await addTag(page, "Skip if missed");
    await addTag(page, "Health");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const vitamin = page.getByRole("button", {
      name: "Edit Vitamin D3",
      exact: true,
    });
    await expect(vitamin).toContainText("Daily");
    // The suggested end date waits for approval.
    await expect(vitamin).toContainText("Suggested change");
    await vitamin.click();
    const editor = page.getByRole("dialog");
    await expect(editor.getByRole("status")).toContainText(
      "Daily 4000 IU ends after two months",
    );
    if (shots) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${shots}-editor.png` });
    }
    await editor.getByRole("button", { name: "Accept" }).click();
    await expect(vitamin).toContainText("until");
    await expect(vitamin).not.toContainText("Suggested change");
    let state = await (await api.get("/api/state")).json();
    const saved = state.tasks.find((t: any) => t.title === "Vitamin D3");
    expect(saved.until).toBe(day(59));
    expect(saved.tags).toEqual(["@skip-missed", "Health"]);

    // Completing a one-off task lets its notes say what comes next.
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Task name").fill("Renew passport");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("After this, remind me to update my address at SEB");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => phases.includes("Renew passport:saved")).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}-tasks.png` });
    await page
      .getByRole("button", { name: "Complete Renew passport", exact: true })
      .click();
    await page.goto("/#assistant");
    await page.getByRole("button", { name: /^Inbox/ }).click();
    // The Inbox refreshes every few seconds after the check runs.
    await expect(
      page.getByText("Add a task to update your address at SEB"),
    ).toBeVisible({ timeout: 20000 });
    if (shots) await page.screenshot({ path: `${shots}-inbox.png` });
    state = await (await api.get("/api/state")).json();
    expect(
      state.tasks.some((t: any) => t.title === "Update address at SEB"),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Accept suggestion for Renew passport" })
      .click();
    await expect
      .poll(async () => {
        const s = await (await api.get("/api/state")).json();
        return s.tasks.find((t: any) => t.title === "Update address at SEB")
          ?.continues_from;
      })
      .toBeTruthy();

    // Undo removes the task the assistant added.
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page
      .getByRole("button", { name: "Undo change to Renew passport" })
      .click();
    await expect
      .poll(async () => {
        const s = await (await api.get("/api/state")).json();
        return s.tasks.some((t: any) => t.title === "Update address at SEB");
      })
      .toBe(false);
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
