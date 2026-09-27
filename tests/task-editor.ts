import type { Page } from "@playwright/test";

// Helpers for the task editor: each detail is an item on the schedule line
// that opens its own row at the bottom of the dialog.
const dialog = (page: Page) => page.getByRole("dialog");

export async function setType(
  page: Page,
  type: "Task" | "Appointment" | "Payment",
) {
  await dialog(page)
    .getByRole("button", { name: /^Type:/ })
    .click();
  await dialog(page)
    .getByRole("group", { name: "Type" })
    .getByRole("button", { name: type, exact: true })
    .click();
}
export async function setDate(page: Page, date: string, time?: string) {
  const item = dialog(page).getByRole("button", { name: /^Date:/ });
  if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
  await dialog(page).getByLabel("Pick a date", { exact: true }).fill(date);
  if (time !== undefined)
    await dialog(page).getByLabel("Pick a time", { exact: true }).fill(time);
}
export async function setTime(page: Page, time: string) {
  const item = dialog(page).getByRole("button", { name: /^Date:/ });
  if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
  await dialog(page).getByLabel("Pick a time", { exact: true }).fill(time);
}
async function open(page: Page, item: RegExp, add: string) {
  const existing = dialog(page).getByRole("button", { name: item });
  if (await existing.count()) {
    if ((await existing.getAttribute("aria-expanded")) !== "true")
      await existing.click();
  } else {
    await dialog(page).getByRole("button", { name: "Add detail" }).click();
    await page.getByRole("menuitem", { name: add, exact: true }).click();
  }
}
export async function setRepeat(
  page: Page,
  repeat: "Never" | "Daily" | "Weekly" | "Monthly" | "Yearly",
) {
  await open(page, /^Repeat:/, "Repeat");
  await dialog(page)
    .getByRole("group", { name: "Repeats" })
    .getByRole("button", { name: repeat, exact: true })
    .click();
}
export async function setMoney(page: Page, amount: string, income = false) {
  await open(page, /^Money:/, "Money");
  if (income)
    await dialog(page).getByRole("button", { name: "+ Income" }).click();
  await dialog(page).getByLabel("Amount in euros").fill(amount);
}
export async function addTag(page: Page, tag: string) {
  const item = dialog(page).getByRole("button", { name: "Tags", exact: true });
  if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
  await dialog(page).getByLabel("Add a tag").fill(tag);
  await dialog(page).getByLabel("Add a tag").press("Enter");
}
