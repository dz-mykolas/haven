import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import PaymentPlanFields, { readPlan } from "./PaymentPlanFields";
import TaskTag from "./TaskTag";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SubmitEvent,
} from "react";
import {
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Coins,
  CreditCard,
  PencilLine,
  Plus,
  Repeat2,
  Sparkles,
  Tag,
  Trash2,
  X,
  CalendarClock,
} from "lucide-react";
import {
  costInput,
  costLabel,
  deviceTimezone,
  parseCost,
  request,
  today,
  type Task,
} from "../lib/api";
import {
  builtInTags,
  isBuiltIn,
  repeatText,
  shownTags,
  tagName,
  unitLabel,
  weekdayNames,
} from "../lib/tasks";
import type { EditorState } from "./Editor";

type Kind = Task["kind"];
type Repeat = Task["repeat"];
type Section = "" | "kind" | "date" | "repeat" | "plan" | "money" | "tags";
const kinds: [Kind, string, typeof CircleCheck][] = [
  ["task", "Task", CircleCheck],
  ["appointment", "Appointment", CalendarDays],
  ["payment", "Payment", CreditCard],
];
const repeats: [Repeat, string][] = [
  ["none", "Never"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];
const planNames = {
  scheduled: "Fixed schedule",
  expected: "Expected purchase",
  prepaid: "Prepaid coverage",
};
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayName = (date: string, now: string) =>
  date === now
    ? "Today"
    : date === shift(now, 1)
      ? "Tomorrow"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${date}T12:00:00Z`));

// A segment that opens the native date or time picker. The input covers the
// face (transparent), so it is focusable and fillable like any input.
function PickSegment({
  type,
  value,
  label,
  pressed,
  onChange,
  children,
}: {
  type: "date" | "time";
  value: string;
  label: string;
  pressed: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="te-pick" data-pressed={pressed ? "" : undefined}>
      <span className="te-pick-face" aria-hidden="true">
        {children}
      </span>
      <input
        className="plain-input"
        type={type}
        aria-label={label}
        value={value}
        min={type === "date" ? "1900-01-01" : undefined}
        max={type === "date" ? "9998-12-31" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Browsers without showPicker keep their own input behaviour.
          }
        }}
      />
    </span>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="te-k">{label}</span>
      <div className="te-v">{children}</div>
    </>
  );
}
function Segments({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="te-seg" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export default function TaskEditor({
  editor,
  tasks,
  onClose,
  onSaved,
}: {
  editor: Extract<EditorState, { type: "task" }>;
  tasks: Task[];
  onClose: () => void;
  onSaved: (undo?: EditorState) => void;
}) {
  const record = editor.record;
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const now = today(record.timezone);
  const [kind, setKind] = useState<Kind>(record.kind);
  const [title, setTitle] = useState(record.title);
  const [notes, setNotes] = useState(record.notes);
  const [date, setDate] = useState(record.date);
  const [time, setTime] = useState(record.time);
  const [repeat, setRepeat] = useState<Repeat>(record.repeat);
  const [every, setEvery] = useState(record.every ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(record.weekdays ?? []);
  const [until, setUntil] = useState(record.until ?? "");
  const [money, setMoney] = useState(costInput(record));
  const [income, setIncome] = useState(!!record.income);
  const [tags, setTags] = useState<string[]>(record.tags ?? []);
  const [planKind, setPlanKind] = useState(record.plan?.kind ?? "scheduled");
  const [open, setOpen] = useState<Section>("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [followUp, setFollowUp] = useState(record.follow_up);

  const scheduled = kind !== "payment" || planKind === "scheduled";
  const shown = shownTags({ tags, kind, repeat: scheduled ? repeat : "none" });
  const moneyValue = (() => {
    try {
      return parseCost(money);
    } catch {
      return null;
    }
  })();
  const toggle = (section: Section) => {
    setAdding(false);
    setOpen((current) => (current === section ? "" : section));
  };
  // Clicking outside the open editor row (and the items that open it) closes it.
  useEffect(() => {
    if (!open && !adding) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element;
      // Pop-ups such as select lists render outside the dialog; only clicks
      // elsewhere inside the editor close the open row.
      if (!target.closest(".task-editor")) return;
      if (target.closest(".te-row-editor, .te-item, .te-add-menu")) return;
      setOpen("");
      setAdding(false);
    };
    // On click rather than pointer down, so collapsing the row never moves a
    // button out from under the click that is closing it.
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open, adding]);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const cost = parseCost(money);
      const plan = kind === "payment" ? readPlan(form) : undefined;
      const repeating = scheduled && repeat !== "none";
      await request(`/tasks/${record.id}`, {
        ...record,
        follow_up: undefined,
        kind,
        title: title.trim(),
        notes,
        date: date || (kind === "payment" ? (plan?.expires_on ?? "") : ""),
        plan,
        time,
        repeat: scheduled ? repeat : "none",
        every: repeating ? every : 1,
        weekdays: repeating && repeat === "weekly" ? weekdays : [],
        until: repeating ? until : "",
        tags,
        income,
        amount_minor:
          kind === "payment" && cost && cost[0] === cost[1] ? cost[0] : "0",
        estimated_min_minor: cost?.[0] ?? null,
        estimated_max_minor: cost?.[1] ?? null,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const saved = await request<Task>(`/tasks/${record.id}`, {
        ...record,
        follow_up: undefined,
        deleted: true,
      });
      onSaved({ type: "task", record: { ...saved, deleted: false } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: "accept" | "dismiss") {
    const proposal = followUp?.proposal;
    if (!proposal) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `/tasks/followups/${proposal.event_id}/${action}`,
        {},
        "POST",
      );
      if (action === "accept") onSaved();
      else setFollowUp({ ...followUp, proposal: undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Tag suggestions: built-in tags this type can use, then yours by use.
  const [tagQuery, setTagQuery] = useState("");
  const [tagActive, setTagActive] = useState(-1);
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks)
      if (!t.deleted)
        for (const tag of t.tags ?? [])
          if (!isBuiltIn(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return counts;
  }, [tasks]);
  const query = tagQuery.replace(/^#/, "").trim();
  const has = (tag: string) =>
    tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  const matches = (tag: string) =>
    !has(tag) && tagName(tag).toLowerCase().includes(query.toLowerCase());
  const specialOptions = Object.keys(builtInTags).filter(
    (t) => builtInTags[t].kinds.includes(kind) && matches(t),
  );
  const ownOptions = [...usage.keys()]
    .filter(matches)
    .sort((a, b) => usage.get(b)! - usage.get(a)!);
  const existing = [...usage.keys(), ...Object.keys(builtInTags).map(tagName)];
  const addOption =
    query &&
    !has(query) &&
    !existing.some((t) => t.toLowerCase() === query.toLowerCase())
      ? query
      : "";
  const options = [...specialOptions, ...ownOptions];
  function addTag(raw: string) {
    let tag = raw.replace(/^#/, "").trim();
    if (!tag) return;
    const builtIn = Object.keys(builtInTags).find(
      (t) => tagName(t).toLowerCase() === tag.toLowerCase(),
    );
    if (builtIn) {
      if (!builtInTags[builtIn].kinds.includes(kind)) return;
      tag = builtIn;
    } else
      tag =
        [...usage.keys()].find((t) => t.toLowerCase() === tag.toLowerCase()) ??
        tag;
    if (!has(tag)) setTags([...tags, tag]);
    setTagQuery("");
    setTagActive(-1);
  }

  const KindIcon = kinds.find(([k]) => k === kind)![2];
  const item = (
    section: Section,
    label: string,
    icon: ReactNode,
    content: ReactNode,
  ) => (
    <button
      type="button"
      className="te-item"
      aria-label={label}
      aria-expanded={open === section}
      onClick={() => toggle(section)}
    >
      {icon}
      {content}
    </button>
  );
  const missing: [Section, string, typeof Repeat2][] = [];
  if (scheduled && repeat === "none")
    missing.push(["repeat", "Repeat", Repeat2]);
  if (!money) missing.push(["money", "Money", Coins]);

  const editors: Record<Exclude<Section, "">, ReactNode> = {
    kind: (
      <div className="te-grid">
        <Row label="Type">
          <Segments label="Type">
            {kinds.map(([k, name, Icon]) => (
              <button
                type="button"
                key={k}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                <Icon size={14} />
                {name}
              </button>
            ))}
          </Segments>
        </Row>
      </div>
    ),
    date: (
      <div className="te-grid">
        <Row label="Date">
          <Segments label="Date">
            <button
              type="button"
              aria-pressed={date === now}
              onClick={() => setDate(now)}
            >
              Today
            </button>
            <button
              type="button"
              aria-pressed={date === shift(now, 1)}
              onClick={() => setDate(shift(now, 1))}
            >
              Tomorrow
            </button>
            <PickSegment
              type="date"
              label="Pick a date"
              value={date}
              pressed={!!date && date !== now && date !== shift(now, 1)}
              onChange={setDate}
            >
              <CalendarDays size={14} />
              {date && date !== now && date !== shift(now, 1)
                ? dayName(date, now)
                : "Pick a date"}
            </PickSegment>
          </Segments>
        </Row>
        <Row label="Time">
          <Segments label="Time">
            <button
              type="button"
              aria-pressed={!time}
              onClick={() => setTime("")}
            >
              Any time
            </button>
            <PickSegment
              type="time"
              label="Pick a time"
              value={time}
              pressed={!!time}
              onChange={setTime}
            >
              <Clock3 size={14} />
              {time || "Pick a time"}
            </PickSegment>
          </Segments>
        </Row>
      </div>
    ),
    repeat: (
      <div className="te-grid">
        <Row label="Repeats">
          <Segments label="Repeats">
            {repeats.map(([value, name]) => (
              <button
                type="button"
                key={value}
                aria-pressed={repeat === value}
                onClick={() => setRepeat(value)}
              >
                {name}
              </button>
            ))}
          </Segments>
        </Row>
        {repeat !== "none" && (
          <>
            <Row label="Every">
              <span className="te-every">
                <input
                  className="te-num plain-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  aria-label="Repeat every"
                  value={every}
                  onChange={(e) =>
                    setEvery(
                      Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                    )
                  }
                />
                {unitLabel(repeat, every)}
              </span>
            </Row>
            {repeat === "weekly" && (
              <Row label="On">
                <div
                  className="te-days"
                  role="group"
                  aria-label="Days of the week"
                >
                  {weekdayNames.map((name, i) => (
                    <button
                      type="button"
                      key={name}
                      aria-label={name}
                      aria-pressed={weekdays.includes(i + 1)}
                      onClick={() =>
                        setWeekdays(
                          weekdays.includes(i + 1)
                            ? weekdays.filter((d) => d !== i + 1)
                            : [...weekdays, i + 1].sort(),
                        )
                      }
                    >
                      {name[0]}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            <Row label="Ends">
              <Segments label="Ends">
                <button
                  type="button"
                  aria-pressed={!until}
                  onClick={() => setUntil("")}
                >
                  Never
                </button>
                <PickSegment
                  type="date"
                  label="End date"
                  value={until}
                  pressed={!!until}
                  onChange={setUntil}
                >
                  <CalendarDays size={14} />
                  {until ? dayName(until, now) : "On a date"}
                </PickSegment>
              </Segments>
            </Row>
          </>
        )}
      </div>
    ),
    plan: (
      <PaymentPlanFields
        value={record.plan}
        onKind={(next) => {
          setPlanKind(next);
          if (next !== "scheduled" && !record.version) setDate("");
        }}
      />
    ),
    money: (
      <div className="te-grid">
        <Row label="Money">
          <span className="te-money">
            <Segments label="Direction">
              <button
                type="button"
                aria-pressed={!income}
                onClick={() => setIncome(false)}
              >
                − Cost
              </button>
              <button
                type="button"
                aria-pressed={income}
                onClick={() => setIncome(true)}
              >
                + Income
              </button>
            </Segments>
            <label className="te-amount">
              <span aria-hidden="true">€</span>
              <input
                className="plain-input"
                aria-label="Amount in euros"
                inputMode="decimal"
                placeholder="25 or 20–30"
                value={money}
                onChange={(e) => setMoney(e.target.value)}
              />
            </label>
          </span>
        </Row>
      </div>
    ),
    tags: (
      <div className="te-tags-editor">
        <div className="te-tag-field">
          {shown.locked.map((t) => (
            <TaskTag key={t} tag={t} locked />
          ))}
          {shown.own.map((t) => (
            <TaskTag
              key={t}
              tag={t}
              onRemove={() => setTags(tags.filter((x) => x !== t))}
            />
          ))}
          <input
            className="plain-input"
            aria-label="Add a tag"
            placeholder="Add tag"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="te-tag-list"
            value={tagQuery}
            autoFocus
            onChange={(e) => {
              setTagQuery(e.target.value);
              setTagActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!options.length) return;
                setTagActive((i) =>
                  e.key === "ArrowDown"
                    ? (i + 1) % options.length
                    : i <= 0
                      ? options.length - 1
                      : i - 1,
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagActive >= 0 ? tagName(options[tagActive]) : tagQuery);
              } else if (
                e.key === "Backspace" &&
                !tagQuery &&
                shown.own.length
              ) {
                const last = shown.own[shown.own.length - 1];
                setTags(tags.filter((t) => t !== last));
              }
            }}
          />
        </div>
        <div
          className="te-tag-list"
          id="te-tag-list"
          role="listbox"
          aria-label="Tag suggestions"
        >
          {addOption && (
            <button
              type="button"
              role="option"
              className="te-tag-option"
              aria-selected={tagActive === -1}
              onClick={() => addTag(addOption)}
            >
              <span className="te-tag-lead">Add</span>
              <TaskTag tag={addOption} dashed />
              <span className="te-tag-note" />
              <kbd>↵ Enter</kbd>
            </button>
          )}
          {specialOptions.length > 0 && (
            <div className="te-tag-section">Built in</div>
          )}
          {specialOptions.map((t, i) => (
            <button
              type="button"
              role="option"
              key={t}
              className="te-tag-option"
              aria-selected={tagActive === i}
              onClick={() => addTag(tagName(t))}
            >
              <TaskTag tag={t} />
              <span className="te-tag-note">{builtInTags[t].description}</span>
            </button>
          ))}
          {ownOptions.length > 0 && (
            <div className="te-tag-section">Your tags</div>
          )}
          {ownOptions.map((t, i) => (
            <button
              type="button"
              role="option"
              key={t}
              className="te-tag-option"
              aria-selected={tagActive === specialOptions.length + i}
              onClick={() => addTag(t)}
            >
              <TaskTag tag={t} />
              <span className="te-tag-note" />
              <span className="te-tag-count">
                {usage.get(t)} {usage.get(t) === 1 ? "task" : "tasks"}
              </span>
            </button>
          ))}
        </div>
      </div>
    ),
  };

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent
        className="editor-dialog task-editor"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Only a new task starts in the title; an existing one opens at rest.
          if (record.version) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        onEscapeKeyDown={(event) => {
          // Escape closes the open row first, then the editor.
          if (open || adding) {
            event.preventDefault();
            setOpen("");
            setAdding(false);
          } else if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">
          {record.version ? "Edit task" : "New task"}
        </DialogTitle>
        <form onSubmit={save}>
          <div className="te-top">
            <span className="te-mark" aria-hidden="true">
              <KindIcon size={20} />
            </span>
            <label className="te-title">
              <input
                className="plain-input"
                aria-label="Task name"
                placeholder="Task name"
                required
                maxLength={200}
                autoFocus={!record.version}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <PencilLine size={15} className="te-edit" aria-hidden="true" />
            </label>
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
              "aria-label": "Task details",
              tabIndex: -1,
            }}
          >
            <fieldset className="te-body" disabled={busy}>
              <label className="te-notes">
                <span className="te-notes-k">
                  Notes
                  <PencilLine
                    size={14}
                    className="te-edit"
                    aria-hidden="true"
                  />
                </span>
                <textarea
                  className="plain-input"
                  name="notes"
                  maxLength={4000}
                  rows={2}
                  placeholder="Details, or what should happen next"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              {followUp?.status === "failed" && (
                <p className="te-note" data-failed="">
                  <CircleAlert size={15} />
                  Couldn’t read notes: {followUp.error}
                </p>
              )}
              {followUp?.proposal && (
                <div className="te-suggestion" role="status">
                  <Sparkles size={15} />
                  <span>{followUp.proposal.message}</span>
                  <Button
                    type="button"
                    className="text-button"
                    onClick={() => void decide("dismiss")}
                  >
                    Dismiss
                  </Button>
                  <Button
                    type="button"
                    className="tonal"
                    onClick={() => void decide("accept")}
                  >
                    <Check size={15} />
                    Accept
                  </Button>
                </div>
              )}
              <div className="te-line">
                {item(
                  "kind",
                  `Type: ${kinds.find(([k]) => k === kind)![1]}`,
                  <KindIcon size={15} />,
                  kinds.find(([k]) => k === kind)![1],
                )}
                {scheduled || date
                  ? item(
                      "date",
                      `Date: ${date ? dayName(date, now) : "none"}${time ? `, ${time}` : ""}`,
                      <CalendarDays size={15} />,
                      <>
                        {date ? dayName(date, now) : "No date"}
                        {time && `, ${time}`}
                      </>,
                    )
                  : null}
                {kind === "payment" &&
                  item(
                    "plan",
                    `Plan: ${planNames[planKind]}`,
                    <CalendarClock size={15} />,
                    planNames[planKind],
                  )}
                {scheduled &&
                  repeat !== "none" &&
                  item(
                    "repeat",
                    `Repeat: ${repeatText({ repeat, every, weekdays, until })}`,
                    <Repeat2 size={15} />,
                    repeatText({ repeat, every, weekdays, until }),
                  )}
                {money &&
                  item(
                    "money",
                    `Money: ${income ? "+" : "−"}${money}`,
                    <Coins size={15} />,
                    <span data-amount-tone={income ? "income" : "estimate"}>
                      {income ? "+" : "−"}
                      {moneyValue ? costLabel(...moneyValue) : `€${money}`}
                    </span>,
                  )}
                {missing.length > 0 && (
                  <span className="te-add-wrap">
                    <button
                      type="button"
                      className="te-item te-add"
                      aria-label="Add detail"
                      aria-expanded={adding}
                      onClick={() => setAdding(!adding)}
                    >
                      <Plus size={16} />
                    </button>
                    {adding && (
                      <span className="te-add-menu" role="menu">
                        {missing.map(([section, name, Icon]) => (
                          <button
                            type="button"
                            role="menuitem"
                            key={section}
                            onClick={() => {
                              setAdding(false);
                              setOpen(section);
                              if (section === "repeat" && repeat === "none")
                                setRepeat("daily");
                            }}
                          >
                            <Icon size={15} />
                            {name}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="te-line">
                <button
                  type="button"
                  className="te-item te-tags"
                  aria-label="Tags"
                  aria-expanded={open === "tags"}
                  onClick={() => toggle("tags")}
                >
                  <Tag size={15} />
                  {shown.locked.length + shown.own.length ? (
                    <span className="task-tag-list">
                      {shown.locked.map((t) => (
                        <TaskTag key={t} tag={t} locked />
                      ))}
                      {shown.own.map((t) => (
                        <TaskTag key={t} tag={t} />
                      ))}
                    </span>
                  ) : (
                    <span className="te-placeholder">Add tags</span>
                  )}
                </button>
              </div>
              {open && open !== "plan" && (
                <div className="te-row-editor">{editors[open]}</div>
              )}
              {/* One payment plan instance stays mounted so its fields are kept while closed. */}
              {kind === "payment" && (
                <div className="te-row-editor" hidden={open !== "plan"}>
                  {editors.plan}
                </div>
              )}
              {record.timezone !== deviceTimezone() && (
                <p className="helper">
                  Times use {record.timezone.replace(/_/g, " ")}
                </p>
              )}
            </fieldset>
          </ScrollArea>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            {record.version > 0 && (
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
            <Button className="primary" type="submit" disabled={busy}>
              <Check size={18} />
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
