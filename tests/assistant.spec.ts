import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("assistant modes, skill toggles, clickable draft previews and persistence", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/#assistant");
  await expect(
    page.getByText("Assistant is off. Your saved reviews are still here."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Assistant preferences", exact: true })
    .click();
  const preferences = page.getByRole("dialog", {
    name: "Your preferences",
    exact: true,
  });
  await expect(
    preferences.getByRole("radio", { name: /Manual only/ }),
  ).toBeChecked();
  await preferences.getByText("Skills & details", { exact: true }).click();
  await expect(
    preferences.getByRole("switch", { name: "Plan tasks", exact: true }),
  ).toBeDisabled();
  await preferences.getByRole("radio", { name: /When I ask/ }).check();
  await preferences
    .getByRole("switch", { name: "Offer estimated costs", exact: true })
    .uncheck();
  await preferences
    .getByRole("switch", { name: "Organize Money", exact: true })
    .uncheck();
  await preferences
    .getByRole("button", { name: "Review Haircut example", exact: true })
    .getByText("Haircut", { exact: true })
    .click();
  const preview = page.getByRole("dialog", {
    name: "Autofilled task",
    exact: true,
  });
  await expect(preview.getByLabel("Task", { exact: true })).toHaveValue(
    "Haircut",
  );
  await expect(
    preview.getByText("This example is not saved.", { exact: false }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Done", exact: true }).click();
  await expect(preferences).toBeVisible();
  await expect(
    preferences.getByRole("group", { name: "Draft presentation", exact: true }),
  ).toHaveCount(0);
  await expect(
    preferences.getByLabel("Example draft appearance"),
  ).toContainText("Friday · 16:30");
  await preferences
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(preferences).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Assistant preferences", exact: true })
    .click();
  await expect(
    preferences.getByRole("radio", { name: /When I ask/ }),
  ).toBeChecked();
  await expect(
    preferences.getByRole("button", {
      name: "Review Haircut example",
      exact: true,
    }),
  ).toContainText("Friday · 16:30");
  await preferences.getByText("Skills & details", { exact: true }).click();
  await expect(
    preferences.getByRole("switch", {
      name: "Offer estimated costs",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    preferences.getByRole("switch", { name: "Organize Money", exact: true }),
  ).not.toBeChecked();
  await preferences.getByRole("radio", { name: /Suggest too/ }).check();
  await expect(
    preferences.getByText(
      "Existing and new transactions · reviewed in your inbox",
    ),
  ).toBeVisible();
  for (const [width, height, theme] of [
    [1280, 1000, "light"],
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
      await preferences.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/assistant-preferences-${width}.png`,
      fullPage: true,
    });
  }
  await preferences.getByRole("radio", { name: /Manual only/ }).check();
  await expect(
    preferences.getByRole("switch", {
      name: "Offer estimated costs",
      exact: true,
    }),
  ).toBeDisabled();
  await preferences
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(preferences).toHaveCount(0);
  const state = await (await page.request.get("/api/assistant")).json();
  expect(state.settings.mode).toBe("manual");
  expect(state.settings.offer_estimated_costs).toBe(false);
  expect(state.settings.skills["organize-money"]).toBe(false);
  expect(state.model_connected).toBe(false);
  await page
    .getByRole("button", { name: "Assistant preferences", exact: true })
    .click();
  await preferences.getByRole("radio", { name: /Suggest too/ }).check();
  await page.keyboard.press("Escape");
  await expect(preferences).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/assistant")).json()).settings.mode,
  ).toBe("manual");
  await page
    .getByRole("button", { name: "Assistant preferences", exact: true })
    .click();
  await page.mouse.click(2, 2);
  await expect(preferences).toHaveCount(0);
  // Restore settings so the other workflow tests run with defaults.
  expect(
    (
      await page.request.put("/api/assistant/settings", {
        data: {
          ...state.settings,
          presentation: "button",
          offer_estimated_costs: true,
          skills: {
            "review-transaction": true,
            "plan-task": true,
            "organize-money": true,
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
});
