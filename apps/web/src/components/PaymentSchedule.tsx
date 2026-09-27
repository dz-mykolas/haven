import Disclosure from "./Disclosure";
import PaymentPlanFields from "./PaymentPlanFields";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import DateField from "./DateField";
import FormSelect from "./FormSelect";
import { useState } from "react";
import {
  costInput,
  dateLabel,
  deviceTimezone,
  type Entry,
  type Task,
} from "../lib/api";

export default function PaymentSchedule({
  entry,
  tasks,
  defaultAmount,
}: {
  entry: Entry;
  tasks: Task[];
  defaultAmount: string;
}) {
  // Keep versions paired with the values shown when the editor was opened.
  const [available] = useState(() =>
    tasks.filter(
      (t) =>
        t.kind === "payment" &&
        (t.repeat !== "none" || (t.plan && t.plan.kind !== "scheduled")) &&
        !t.done &&
        !t.deleted,
    ),
  );
  const matches = available.filter(
    (t) => t.title.trim().toLowerCase() === entry.payee.trim().toLowerCase(),
  );
  const [selected, setSelected] = useState(
    entry.payment?.version
      ? entry.payment.id
      : matches.length === 1
        ? matches[0].id
        : "new",
  );
  const [enabled, setEnabled] = useState(true);
  const [newID] = useState(() => entry.payment?.id ?? crypto.randomUUID());
  const payment =
    selected === "new"
      ? entry.payment
      : entry.payment?.id === selected
        ? entry.payment
        : available.find((t) => t.id === selected);
  const [edits, setEdits] = useState<
    Record<string, { amount: string; repeat: string; date: string }>
  >({});
  const fields = edits[selected] ?? {
    amount: payment ? costInput(payment) : defaultAmount,
    repeat: payment?.repeat === "none" ? "" : (payment?.repeat ?? ""),
    date: payment?.date ?? "",
  };
  const [planKind, setPlanKind] = useState(payment?.plan?.kind ?? "scheduled");
  const [editing, setEditing] = useState(!fields.date || !fields.repeat);
  const update = (change: Partial<typeof fields>) =>
    setEdits({ ...edits, [selected]: { ...fields, ...change } });
  const frequency: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
  };
  return (
    <section
      className="payment-schedule"
      aria-label="Recurring payment schedule"
    >
      <div className="schedule-heading">
        <span>Future payments</span>
        {entry.payment?.version ? (
          <>
            <Input type="hidden" name="plan-payment" value="on" />
            <span className="schedule-status">Linked</span>
          </>
        ) : (
          <Switch
            name="plan-payment"
            aria-label="Schedule future payments"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        )}
      </div>
      <fieldset
        className="schedule-fields"
        hidden={!enabled}
        disabled={!enabled}
      >
        <Disclosure
          className="schedule-details"
          label="Edit payment schedule"
          open={
            editing ||
            (planKind === "scheduled" && (!fields.date || !fields.repeat))
          }
          onOpenChange={setEditing}
          title={
            <>
              <span className="schedule-summary">
                <strong>
                  {fields.amount ? (
                    <span data-amount-tone="estimate">€{fields.amount}</span>
                  ) : (
                    "Amount not set"
                  )}
                  {fields.repeat ? ` · ${frequency[fields.repeat]}` : ""}
                </strong>
                <span>
                  {fields.date
                    ? `Next ${dateLabel(fields.date)}`
                    : "Set the next payment"}
                </span>
              </span>
              <span className="schedule-edit">Edit</span>
            </>
          }
        >
          <div key={selected}>
            <Input
              type="hidden"
              name="payment-id"
              value={payment?.id ?? newID}
            />
            <Input
              type="hidden"
              name="payment-version"
              value={payment?.version ?? 0}
            />
            <Input
              aria-label="Plan name"
              name="payment-title"
              defaultValue={payment?.title ?? entry.payee}
            />
            <Input
              type="hidden"
              name="payment-timezone"
              value={payment?.timezone ?? deviceTimezone()}
            />
            <Input
              type="hidden"
              name="payment-time"
              value={payment?.time ?? ""}
            />
            <Input
              type="hidden"
              name="payment-notes"
              value={payment?.notes ?? ""}
            />
            <Input
              type="hidden"
              name="payment-anchor"
              value={payment?.anchor_day ?? 0}
            />
            <PaymentPlanFields
              key={selected}
              name="payment-plan"
              value={payment?.plan}
              onKind={setPlanKind}
            />
            {planKind !== "scheduled" && (
              <label className="field">
                <span>Quantity purchased</span>
                <Input
                  name="payment-units"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={entry.payment_units || 1}
                />
              </label>
            )}
            <div className="form-grid">
              <label className="field">
                <span>Amount · EUR</span>
                <Input
                  name="payment-amount"
                  data-amount-tone="estimate"
                  placeholder="Not set"
                  aria-label="Expected amount · EUR"
                  value={fields.amount}
                  onChange={(event) => update({ amount: event.target.value })}
                />
              </label>
              {planKind === "scheduled" ? (
                <label className="field">
                  <span>Frequency</span>
                  <FormSelect
                    name="payment-repeat"
                    aria-label="Payment frequency"
                    required
                    value={fields.repeat}
                    onChange={(event) => update({ repeat: event.target.value })}
                  >
                    <option value="" disabled>
                      Choose frequency
                    </option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </FormSelect>
                </label>
              ) : (
                <input type="hidden" name="payment-repeat" value="none" />
              )}
            </div>
            <label className="field">
              <span>Next payment</span>
              <DateField
                name="payment-date"
                aria-label="Next expected payment"
                type="date"
                required={planKind === "scheduled"}
                min="1900-01-01"
                max="9998-12-31"
                defaultValue={fields.date}
                onValueChange={(date) => update({ date })}
              />
            </label>
          </div>
          {available.length > 0 && !entry.payment?.version && (
            <Disclosure
              className="schedule-options"
              title={
                <>
                  <span>
                    {selected === "new"
                      ? "Link a schedule"
                      : `Linked to ${payment?.title ?? "payment"}`}
                  </span>
                </>
              }
            >
              <label className="field">
                <span>Payment schedule</span>
                <FormSelect
                  aria-label="Payment schedule"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setPlanKind(
                      available.find((t) => t.id === e.target.value)?.plan
                        ?.kind ?? "scheduled",
                    );
                  }}
                >
                  <option value="new">Create a schedule</option>
                  {available.map((t) => (
                    <option key={t.id} value={t.id}>
                      Use existing: {t.title}
                    </option>
                  ))}
                </FormSelect>
              </label>
            </Disclosure>
          )}
        </Disclosure>
      </fieldset>
    </section>
  );
}
