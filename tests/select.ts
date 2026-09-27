import type { Locator } from "@playwright/test";

export async function selectOption(
  control: Locator,
  choice: string | { label: string },
) {
  await control.click();
  const page = control.page();
  if (typeof choice === "string") {
    await page
      .locator(
        `[data-slot="select-item"][data-value="${choice || "__empty__"}"]`,
      )
      .click();
  } else {
    await page.getByRole("option", { name: choice.label, exact: true }).click();
  }
}
