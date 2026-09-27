import FormSelect from "./FormSelect";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import Disclosure from "./Disclosure";
import DateField from "./DateField";
import TransactionLabels from "./TransactionLabels";
import PaymentSchedule from "./PaymentSchedule";
import PaymentPlanFields, { readPlan } from "./PaymentPlanFields";
import { SelectionGroup } from "./Motion";
import { useState, type SubmitEvent, type ReactNode } from "react";
import {
  Check,
  Trash2,
  X,
  Wallet,
  CalendarDays,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  CircleCheck,
  CreditCard,
  Clock3,
} from "lucide-react";
import {
  cents,
  amountTone,
  costInput,
  taskCost,
  parseCost,
  decimal,
  money,
  dateLabel,
  deviceTimezone,
  request,
  today,
  type Account,
  type Category,
  type Entry,
  type Task,
} from "../lib/api";

export type EditorState =
  | { type: "account"; record: Account }
  | { type: "entry"; record: Entry; review?: boolean; reviewReason?: string }
  | { type: "task"; record: Task };
export const newAccount = (): EditorState => ({
  type: "account",
  record: {
    id: crypto.randomUUID(),
    name: "",
    currency: "EUR",
    opening_minor: "0",
    version: 0,
  },
});
export const newEntry = (accountID: string): EditorState => ({
  type: "entry",
  record: {
    id: crypto.randomUUID(),
    account_id: accountID,
    destination_id: "",
    kind: "expense",
    amount_minor: "0",
    date: today(),
    payee: "",
    category: "",
    notes: "",
    deleted: false,
    version: 0,
  },
});
export const newTask = (date = today()): EditorState => ({
  type: "task",
  record: {
    id: crypto.randomUUID(),
    title: "",
    date,
    time: "",
    timezone: deviceTimezone(),
    repeat: "none",
    anchor_day: 0,
    kind: "task",
    amount_minor: "0",
    notes: "",
    done: false,
    deleted: false,
    version: 0,
  },
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export default function Editor({
  editor,
  accounts,
  categories,
  tagSuggestions,
  tasks = [],
  onClose,
  onSaved,
}: {
  editor: EditorState;
  accounts: Account[];
  categories: Category[];
  tagSuggestions: string[];
  tasks?: Task[];
  onClose: () => void;
  onSaved: (undo?: EditorState) => void;
}) {
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [kind, setKind] = useState(
    editor.type === "account" ? "" : editor.record.kind,
  );
  const [categoryID, setCategoryID] = useState(
    editor.type === "entry" ? (editor.record.category_id ?? "") : "",
  );
  const [entryAmount, setEntryAmount] = useState(
    editor.type === "entry" && editor.record.version
      ? decimal(editor.record.amount_minor)
      : "",
  );
  const [taskDate, setTaskDate] = useState(
    editor.type === "task" ? editor.record.date : "",
  );
  const [planKind, setPlanKind] = useState(
    editor.type === "task"
      ? (editor.record.plan?.kind ?? "scheduled")
      : "scheduled",
  );
  const hasPaymentSchedule =
    editor.type === "entry" &&
    kind === "expense" &&
    (!!editor.record.payment ||
      categories.find((c) => c.id === categoryID)?.name.toLowerCase() ===
        "recurring");
  const retainedTransfer =
    editor.type === "entry" &&
    editor.record.kind === "transfer" &&
    (!accounts.some((a) => a.id === editor.record.account_id) ||
      !accounts.some((a) => a.id === editor.record.destination_id));
  const readOnly = retainedTransfer && !editor.record.source;
  const reviewing = editor.type === "entry" && !!editor.review;
  const bankEntry =
    editor.type === "entry" && (!!editor.record.source || reviewing);
  const title = reviewing
    ? "Review transaction"
    : bankEntry
      ? "Bank transaction"
      : `${editor.record.version ? "Edit" : "New"} ${editor.type === "entry" ? "transaction" : editor.type}`;
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget),
      value = (name: string) => String(form.get(name) ?? "").trim();
    try {
      if (editor.type === "account") {
        await request(`/accounts/${editor.record.id}`, {
          ...editor.record,
          name: value("name"),
          opening_minor: cents(value("amount"), true),
        });
      } else if (editor.type === "entry") {
        const tags = form.getAll("tags").map(String);
        if (value("tag-draft")) tags.push(value("tag-draft"));
        let payment: Task | undefined;
        if (hasPaymentSchedule && form.has("plan-payment")) {
          const cost = parseCost(value("payment-amount"));
          payment = {
            id: value("payment-id"),
            version: Number(value("payment-version")),
            title:
              value("payment-title") ||
              (bankEntry ? editor.record.payee : value("payee")),
            date:
              value("payment-date") ||
              readPlan(form, "payment-plan")?.expires_on ||
              "",
            plan: readPlan(form, "payment-plan"),
            time: value("payment-time"),
            timezone: value("payment-timezone"),
            repeat: value("payment-repeat") as Task["repeat"],
            anchor_day: Number(value("payment-anchor")),
            kind: "payment",
            amount_minor: cost && cost[0] === cost[1] ? cost[0] : "0",
            estimated_min_minor: cost?.[0] ?? null,
            estimated_max_minor: cost?.[1] ?? null,
            notes: String(form.get("payment-notes") ?? ""),
            done: false,
            deleted: false,
          };
        }
        const annotations = {
          payment,
          payment_units: Number(value("payment-units")) || 0,
          category_id: value("category_id"),
          tags,
          notes: reviewing ? String(form.get("notes") ?? "") : value("notes"),
          version: editor.record.version,
        };
        if (reviewing) {
          await request(
            `/assistant/inbox/${editor.record.id}/apply`,
            annotations,
            "POST",
          );
        } else if (bankEntry) {
          await request(
            `/banking/transactions/${editor.record.id}/annotations`,
            annotations,
          );
        } else
          await request(`/entries/${editor.record.id}`, {
            ...editor.record,
            kind,
            account_id: value("account"),
            destination_id: kind === "transfer" ? value("destination") : "",
            amount_minor: cents(value("amount")),
            date: value("date"),
            payee: value("payee"),
            category: "",
            ...annotations,
          });
      } else {
        const cost = parseCost(value("amount"));
        await request(`/tasks/${editor.record.id}`, {
          ...editor.record,
          kind,
          title: value("title"),
          date:
            value("date") ||
            (kind === "payment" ? readPlan(form)?.expires_on : "") ||
            "",
          plan: kind === "payment" ? readPlan(form) : undefined,
          time: value("time"),
          timezone: value("timezone"),
          repeat: value("repeat"),
          amount_minor:
            kind === "payment" && cost && cost[0] === cost[1] ? cost[0] : "0",
          estimated_min_minor: cost?.[0] ?? null,
          estimated_max_minor: cost?.[1] ?? null,
          notes: value("notes"),
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (editor.type === "account") return;
    setBusy(true);
    setError("");
    try {
      if (editor.type === "entry") {
        const record = await request<Entry>(`/entries/${editor.record.id}`, {
          ...editor.record,
          payment: undefined,
          deleted: true,
        });
        onSaved({ type: "entry", record: { ...record, deleted: false } });
      } else {
        const record = await request<Task>(`/tasks/${editor.record.id}`, {
          ...editor.record,
          deleted: true,
        });
        onSaved({ type: "task", record: { ...record, deleted: false } });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`editor-dialog ${editor.type === "entry" ? "transaction-editor" : ""}`}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form onSubmit={save}>
          <div className="dialog-heading">
            {editor.type !== "entry" && (
              <span className="icon-tile">
                {editor.type === "account" ? <Wallet /> : <CalendarDays />}
              </span>
            )}
            <DialogTitle>{title}</DialogTitle>
            <Button
              type="button"
              className="icon-button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              disabled={busy}
            >
              <X />
            </Button>
          </div>
          <ScrollArea
            className="editor-scroll-area"
            type="auto"
            viewportProps={{
              role: "region",
              "aria-label":
                editor.type === "entry"
                  ? "Transaction details"
                  : "Editor fields",
              tabIndex: 0,
            }}
          >
            <div className="editor-scroll-content">
              {readOnly && (
                <p className="helper">
                  This transfer is kept to preserve the other account’s balance.
                </p>
              )}
              <fieldset disabled={busy || readOnly}>
                {editor.type === "account" && (
                  <>
                    <Field label="Account name">
                      <Input
                        name="name"
                        autoFocus
                        required
                        maxLength={100}
                        placeholder="e.g. SEB, Revolut, Cash"
                        defaultValue={editor.record.name}
                      />
                    </Field>
                    <Field label="Opening balance · EUR">
                      <Input
                        name="amount"
                        inputMode="decimal"
                        required
                        defaultValue={decimal(editor.record.opening_minor)}
                      />
                    </Field>
                    <p className="helper">
                      Start with the balance before your first recorded
                      transaction.
                    </p>
                  </>
                )}
                {editor.type === "entry" && (
                  <>
                    {bankEntry ? (
                      <section
                        className="transaction-summary"
                        aria-label="Recorded transaction"
                      >
                        <div className="transaction-summary-main">
                          <h3>
                            {editor.record.payee ||
                              (kind === "transfer"
                                ? "Transfer"
                                : "Transaction")}
                          </h3>
                          <strong data-amount-tone={amountTone(kind)}>
                            {kind === "expense"
                              ? "−"
                              : kind === "income"
                                ? "+"
                                : ""}
                            {money(editor.record.amount_minor)}
                          </strong>
                        </div>
                        <p className="transaction-meta">
                          <span>{dateLabel(editor.record.date)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {accounts.find(
                              (a) => a.id === editor.record.account_id,
                            )?.name ?? "Removed account"}
                            {kind === "transfer" && (
                              <>
                                {" → "}
                                {accounts.find(
                                  (a) => a.id === editor.record.destination_id,
                                )?.name ?? "Removed account"}
                              </>
                            )}
                          </span>
                        </p>
                      </section>
                    ) : (
                      <fieldset>
                        <SelectionGroup
                          className="segments"
                          label="Transaction type"
                          value={kind}
                        >
                          {(["expense", "income", "transfer"] as const).map(
                            (type) => (
                              <Button
                                type="button"
                                key={type}
                                aria-pressed={kind === type}
                                onClick={() => setKind(type)}
                              >
                                {type === "expense" ? (
                                  <ArrowUpRight size={15} />
                                ) : type === "income" ? (
                                  <ArrowDownLeft size={15} />
                                ) : (
                                  <ArrowRightLeft size={15} />
                                )}
                                {type}
                              </Button>
                            ),
                          )}
                        </SelectionGroup>
                        <div className="form-grid">
                          <Field label="Amount · EUR">
                            <Input
                              name="amount"
                              data-amount-tone={amountTone(kind)}
                              autoFocus
                              inputMode="decimal"
                              required
                              placeholder="0.00"
                              onChange={(e) => setEntryAmount(e.target.value)}
                              defaultValue={
                                editor.record.version
                                  ? decimal(editor.record.amount_minor)
                                  : ""
                              }
                            />
                          </Field>
                          <Field label="Date">
                            <DateField
                              name="date"
                              type="date"
                              required
                              min="1900-01-01"
                              max="9998-12-31"
                              defaultValue={editor.record.date}
                            />
                          </Field>
                        </div>
                        <Field
                          label={
                            kind === "transfer" ? "From account" : "Account"
                          }
                        >
                          <FormSelect
                            name="account"
                            defaultValue={editor.record.account_id}
                            required
                          >
                            {retainedTransfer &&
                              !accounts.some(
                                (a) =>
                                  a.id === (editor.record as Entry).account_id,
                              ) && (
                                <option
                                  value={(editor.record as Entry).account_id}
                                >
                                  Removed account
                                </option>
                              )}
                            {accounts
                              .filter((a) => bankEntry || !a.source)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </FormSelect>
                        </Field>
                        {kind === "transfer" && (
                          <Field label="To account">
                            <FormSelect
                              name="destination"
                              required
                              defaultValue={editor.record.destination_id}
                            >
                              <option value="" disabled>
                                Choose account
                              </option>
                              {retainedTransfer &&
                                !accounts.some(
                                  (a) =>
                                    a.id ===
                                    (editor.record as Entry).destination_id,
                                ) && (
                                  <option
                                    value={
                                      (editor.record as Entry).destination_id
                                    }
                                  >
                                    Removed account
                                  </option>
                                )}
                              {accounts
                                .filter((a) => bankEntry || !a.source)
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                            </FormSelect>
                          </Field>
                        )}
                        <Field
                          label={
                            kind === "transfer"
                              ? "Description"
                              : "Payee / description"
                          }
                        >
                          <Input
                            name="payee"
                            maxLength={200}
                            placeholder={
                              kind === "expense" ? "What was it for?" : ""
                            }
                            defaultValue={editor.record.payee}
                          />
                        </Field>
                      </fieldset>
                    )}
                    <TransactionLabels
                      entry={editor.record}
                      categories={categories}
                      suggestions={tagSuggestions}
                      onCategoryChange={setCategoryID}
                    >
                      {hasPaymentSchedule && (
                        <PaymentSchedule
                          entry={editor.record}
                          tasks={tasks}
                          defaultAmount={entryAmount}
                        />
                      )}
                    </TransactionLabels>
                    {(editor.reviewReason ||
                      (bankEntry && editor.record.bank_description)) && (
                      <Disclosure
                        className="bank-description"
                        title={
                          <>
                            <span>
                              {editor.reviewReason
                                ? "Why this suggestion"
                                : "Bank details"}
                            </span>
                          </>
                        }
                      >
                        {editor.reviewReason && (
                          <p className="review-evidence">
                            {editor.reviewReason}
                          </p>
                        )}
                        {bankEntry && editor.record.bank_description && (
                          <p className="bank-original">
                            {editor.record.bank_description}
                          </p>
                        )}
                      </Disclosure>
                    )}
                  </>
                )}
                {editor.type === "task" && (
                  <>
                    <Field label="What’s the plan?">
                      <Input
                        name="title"
                        autoFocus
                        required
                        maxLength={200}
                        placeholder="Vitamins, a haircut, rent…"
                        defaultValue={editor.record.title}
                      />
                    </Field>
                    <SelectionGroup
                      className="segments"
                      label="Task type"
                      value={kind}
                    >
                      {(["task", "appointment", "payment"] as const).map(
                        (type) => (
                          <Button
                            type="button"
                            key={type}
                            aria-pressed={kind === type}
                            onClick={() => setKind(type)}
                          >
                            {type === "task" ? (
                              <CircleCheck size={15} />
                            ) : type === "appointment" ? (
                              <CalendarDays size={15} />
                            ) : (
                              <CreditCard size={15} />
                            )}
                            {type}
                          </Button>
                        ),
                      )}
                    </SelectionGroup>
                    <div className="form-grid">
                      <Field label="Date">
                        <DateField
                          name="date"
                          required={
                            kind !== "payment" || planKind === "scheduled"
                          }
                          type="date"
                          min="1900-01-01"
                          max="9998-12-31"
                          value={taskDate}
                          onValueChange={setTaskDate}
                        />
                      </Field>
                      <Field label="Time · optional">
                        <Input
                          name="time"
                          type="time"
                          defaultValue={editor.record.time}
                        />
                      </Field>
                    </div>
                    {kind === "payment" && (
                      <PaymentPlanFields
                        value={editor.record.plan}
                        onKind={(next) => {
                          setPlanKind(next);
                          if (next !== "scheduled" && !editor.record.version)
                            setTaskDate("");
                        }}
                      />
                    )}
                    {kind !== "payment" || planKind === "scheduled" ? (
                      <Field label="Repeat">
                        <FormSelect
                          name="repeat"
                          defaultValue={editor.record.repeat}
                        >
                          <option value="none">Doesn’t repeat</option>
                          <option value="daily">Every day</option>
                          <option value="weekly">Every week</option>
                          <option value="monthly">Every month</option>
                          <option value="yearly">Every year</option>
                        </FormSelect>
                      </Field>
                    ) : (
                      <input type="hidden" name="repeat" value="none" />
                    )}
                    {(kind !== "task" || taskCost(editor.record)) && (
                      <Field
                        label={
                          kind === "payment"
                            ? "Expected amount · EUR"
                            : "Estimated cost · EUR"
                        }
                      >
                        <Input
                          name="amount"
                          placeholder="Optional · e.g. 60–70"
                          data-amount-tone="estimate"
                          defaultValue={costInput(editor.record)}
                        />
                      </Field>
                    )}
                    <Disclosure
                      title={
                        <>
                          <Clock3 size={17} />
                          <span>Timezone & notes</span>
                        </>
                      }
                    >
                      <Field label="Timezone">
                        <Input
                          name="timezone"
                          required
                          defaultValue={editor.record.timezone}
                          maxLength={100}
                        />
                      </Field>
                      <p className="helper">
                        From your device. Kept with this task when you travel.
                      </p>
                      <Field label="Notes">
                        <Textarea
                          name="notes"
                          maxLength={4000}
                          defaultValue={editor.record.notes}
                          rows={3}
                        />
                      </Field>
                    </Disclosure>
                  </>
                )}
              </fieldset>
            </div>
          </ScrollArea>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {!bankEntry &&
              !readOnly &&
              editor.type !== "account" &&
              editor.record.version > 0 && (
                <Button
                  className="icon-button danger"
                  type="button"
                  aria-label="Delete"
                  title="Delete"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  <Trash2 />
                </Button>
              )}
            <span className="spacer" />
            {editor.type !== "entry" && (
              <Button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
            )}
            {!readOnly && (
              <Button className="primary" type="submit" disabled={busy}>
                {editor.type !== "entry" && <Check size={18} />}
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
