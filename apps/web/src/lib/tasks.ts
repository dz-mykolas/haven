import type { Task } from "./api";

// Built-in tags are stored by ID ("@…") and change how a task behaves.
export const SKIP_MISSED = "@skip-missed";
export const builtInTags: Record<
  string,
  { name: string; description: string; kinds: Task["kind"][] }
> = {
  [SKIP_MISSED]: {
    name: "Skip if missed",
    description: "A missed day passes instead of staying overdue",
    kinds: ["task"],
  },
};
export const lockedWhy = "Appointments always move on to the next date";
export const isBuiltIn = (tag: string) => tag in builtInTags;
export const tagName = (tag: string) => builtInTags[tag]?.name ?? tag;

// Tags as shown: a repeating appointment always skips missed days (locked);
// built-in tags come first, then the user's own in the order added.
export function shownTags(task: Pick<Task, "tags" | "kind" | "repeat">) {
  const own = (task.tags ?? []).filter(
    (t) => !isBuiltIn(t) || builtInTags[t].kinds.includes(task.kind),
  );
  own.sort((a, b) => Number(isBuiltIn(b)) - Number(isBuiltIn(a)));
  const locked =
    task.kind === "appointment" && task.repeat !== "none" ? [SKIP_MISSED] : [];
  return { locked, own };
}

const units: Record<string, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};
const plain: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};
export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function shortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

// "Daily", "Every 10 days", "Every 2 weeks on Mon, Thu until 27 Nov".
export function repeatText(
  task: Pick<Task, "repeat" | "every" | "weekdays" | "until">,
  withEnd = true,
) {
  if (task.repeat === "none") return "";
  const every = task.every ?? 1;
  let text =
    every > 1
      ? `Every ${every} ${units[task.repeat][1]}`
      : plain[task.repeat];
  if (task.repeat === "weekly" && task.weekdays?.length)
    text += ` on ${task.weekdays.map((d) => weekdayNames[d - 1]).join(", ")}`;
  if (withEnd && task.until) text += ` until ${shortDate(task.until)}`;
  return text;
}
export function unitLabel(repeat: Task["repeat"], every: number) {
  return units[repeat]?.[every > 1 ? 1 : 0] ?? "";
}
