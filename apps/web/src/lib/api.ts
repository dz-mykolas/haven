import type { components } from "./api.generated";
export type Category = components["schemas"]["Category"];
export type Account = components["schemas"]["Account"];
export type Entry = components["schemas"]["Entry"];
export type Task = components["schemas"]["Task"];
export type Snapshot = components["schemas"]["Snapshot"];

export type AmountTone = "income" | "spending" | "estimate" | "neutral";
export function amountTone(kind: string): AmountTone {
  if (kind === "income") return "income";
  if (kind === "transfer") return "neutral";
  return "spending";
}
export function entryAmountTone(entry: Pick<Entry, "kind">): AmountTone {
  return amountTone(entry.kind);
}

export async function request<T>(
  path: string,
  body?: unknown,
  method = "PUT",
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api${path}`,
      body === undefined
        ? { cache: "no-store", signal }
        : {
            method,
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error(
      "Cannot reach Haven. Your changes have not been confirmed. Please try again.",
    );
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(
      problem?.error ?? "Haven is unavailable. Please try again.",
    );
  }
  return response.json();
}

export function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function today(timezone = deviceTimezone()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function money(minor: string) {
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "−" : ""}€${(abs / 100n).toLocaleString("en-IE")}.${String(abs % 100n).padStart(2, "0")}`;
}
export function decimal(minor: string) {
  const value = BigInt(minor),
    abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export function cents(raw: string, signed = false) {
  const value = raw.trim().replace(",", ".");
  if (!(signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(value))
    throw new Error("Enter a euro amount with up to two decimal places.");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > 9000000000000n) throw new Error("That amount is too large.");
  return ((value.startsWith("-") ? -1n : 1n) * minor).toString();
}
export function dateLabel(date: string) {
  if (!date) return "Timing unknown";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function taskCost(task: Task): [string, string] | null {
  if (task.estimated_min_minor != null && task.estimated_max_minor != null)
    return [task.estimated_min_minor, task.estimated_max_minor];
  return task.kind === "payment" && task.amount_minor !== "0"
    ? [task.amount_minor, task.amount_minor]
    : null;
}
export function costLabel(minimum: string, maximum: string) {
  return minimum === maximum
    ? money(minimum)
    : `${money(minimum)}–${money(maximum)}`;
}
export function costInput(task: Task) {
  const cost = taskCost(task);
  return !cost
    ? ""
    : cost[0] === cost[1]
      ? decimal(cost[0])
      : `${decimal(cost[0])}–${decimal(cost[1])}`;
}
export function parseCost(raw: string): [string, string] | null {
  if (!raw.trim()) return null;
  const parts = raw
    .replaceAll("€", "")
    .trim()
    .split(/\s*[-–—]\s*/);
  if (parts.length > 2 || parts.some((p) => !p.trim()))
    throw new Error("Enter a cost or range, such as 60–70.");
  const min = cents(parts[0]),
    max = cents(parts[1] ?? parts[0]);
  if (BigInt(max) < BigInt(min))
    throw new Error("The upper estimate must be at least the lower estimate.");
  return [min, max];
}
