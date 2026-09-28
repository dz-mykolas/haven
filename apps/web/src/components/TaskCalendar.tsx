import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Lock,
  Plus,
  Repeat2,
  Search,
  SkipForward,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { request, taskCost, today, type Task } from "../lib/api";
import type { components } from "../lib/api.generated";
import { MotionView, SelectionGroup, AnimatedTaskList } from "./Motion";
import MoneyText from "./MoneyText";
import {
  isBuiltIn,
  lockedWhy,
  repeatText,
  shownTags,
  tagName,
} from "../lib/tasks";

type CalendarData = components["schemas"]["TaskCalendar"];
type Occurrence = CalendarData["items"][number];
type Filter = "active" | "today" | "done" | "day";

const fullDate = (day: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
const iso = (date: Date) => date.toISOString().slice(0, 10);
function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return iso(date);
}
function shiftMonth(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`),
    original = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(original, last.getUTCDate()));
  return iso(date);
}
// Whole weeks only: the neighbouring months' days fill the first and last rows.
function monthDays(month: string) {
  const first = `${month}-01`;
  const lastDate = new Date(`${first}T12:00:00Z`);
  lastDate.setUTCMonth(lastDate.getUTCMonth() + 1);
  lastDate.setUTCDate(0);
  const weekday = (day: string) =>
    (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(first, -weekday(first));
  const end = shiftDay(iso(lastDate), 6 - weekday(iso(lastDate)));
  const days: string[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day);
  return days;
}
// "Today", "Tomorrow", "Wed 30 Sep"; the year only when it isn't this year.
function dayHeading(day: string, now: string) {
  if (day === now) return "Today";
  if (day === shiftDay(now, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: day.slice(0, 4) === now.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}
const shortDate = (day: string) =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));

// Planned amounts drop ".00": whole euros show as integers.
function planned(minor: bigint) {
  const abs = minor < 0n ? -minor : minor;
  const euros = (abs / 100n).toLocaleString("en-IE");
  return abs % 100n === 0n
    ? `€${euros}`
    : `€${euros}.${String(abs % 100n).padStart(2, "0")}`;
}
// A task's amount with its sign: minus for a cost, plus for income.
function amount(task: Task) {
  const cost = taskCost(task);
  if (!cost) return null;
  const [min, max] = cost.map(BigInt);
  const text = min === max ? planned(min) : `${planned(min)}–${planned(max)}`;
  return { text: `${task.income ? "+" : "−"}${text}`, income: !!task.income };
}
// A day's total appears only when it adds something: two or more amounts.
function dayTotal(items: Occurrence[]) {
  const priced = items.filter((item) => taskCost(item.task));
  if (priced.length < 2) return null;
  let cost = 0n,
    income = 0n,
    ranged = false;
  for (const { task } of priced) {
    const [min, max] = taskCost(task)!.map(BigInt);
    if (task.income) income += min;
    else {
      cost += max;
      ranged ||= min !== max;
    }
  }
  return {
    cost: cost ? `${ranged ? "≈ " : ""}−${planned(cost)}` : "",
    income: income ? `+${planned(income)}` : "",
  };
}
const matchesSearch = (task: Task, search: string) =>
  `${task.title} ${task.notes} ${(task.tags ?? []).map(tagName).join(" ")}`
    .toLowerCase()
    .includes(search.toLowerCase());
const isDone = (task: Task) =>
  task.done ||
  (!!task.date &&
    task.plan?.kind !== "scheduled" &&
    task.plan?.reminder_completed_on === task.date);
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tags on their own line: built-in tags as an icon chip and your first tag
// plus a count; the rest widen into place on hover or keyboard focus.
function RowTags({ task }: { task: Task }) {
  const { locked, own } = shownTags(task);
  const special = [...locked, ...own.filter(isBuiltIn)];
  const mine = own.filter((tag) => !isBuiltIn(tag));
  if (!special.length && !mine.length) return null;
  return (
    <span className="tl-tagline">
      <span className="tl-tags">
        {special.map((tag, index) => (
          <span
            key={tag}
            className="tl-chip"
            data-special=""
            data-locked={index < locked.length ? "" : undefined}
            title={
              index < locked.length
                ? `${tagName(tag)} · ${lockedWhy}`
                : tagName(tag)
            }
          >
            {index < locked.length ? (
              <Lock size={11} aria-hidden="true" />
            ) : (
              <SkipForward size={11} aria-hidden="true" />
            )}
            <span className="tl-chip-label">{tagName(tag)}</span>
          </span>
        ))}
        {mine.map((tag, index) => (
          <span
            key={tag}
            className="tl-chip"
            data-extra={index ? "" : undefined}
          >
            <span className="tl-hash" aria-hidden="true">
              #
            </span>
            {tag}
          </span>
        ))}
        {mine.length > 1 && (
          <span className="tl-chip" data-more="" aria-hidden="true">
            +{mine.length - 1}
          </span>
        )}
      </span>
    </span>
  );
}

// One task row. The left strip is the complete button: tapping fills the ring
// and a three-second ring drains (the circle is then the undo button); dragging
// the row to the right completes it at once. Either way it slides out and its
// gap closes before the list updates.
function TaskRow({
  item,
  filter,
  onEdit,
  onComplete,
}: {
  item: Occurrence;
  filter: Filter;
  onEdit: (task: Task) => void;
  onComplete: (task: Task, row: HTMLElement, dragged?: boolean) => void;
}) {
  const task = item.task;
  const row = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{
    x: number;
    y: number;
    dx: number;
    active: boolean;
    id: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const overdue = !item.completed && item.date < today(task.timezone);
  const locked = item.completed || item.projected || filter === "done";
  const money = amount(task);

  function tick() {
    if (pending) {
      clearTimeout(timer.current);
      setPending(false);
      return;
    }
    setPending(true);
    timer.current = setTimeout(() => {
      setPending(false);
      if (row.current) onComplete(task, row.current);
    }, 3000);
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (locked || pending || event.button > 0) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      active: false,
      id: event.pointerId,
    };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (
      !state ||
      event.pointerId !== state.id ||
      !inner.current ||
      !row.current
    )
      return;
    const dx = event.clientX - state.x,
      dy = event.clientY - state.y;
    if (!state.active) {
      // Vertical movement is scrolling; only a sideways drag takes the row.
      // So is a leftward swipe: on phones it changes module.
      if ((Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) || dx <= -8) {
        drag.current = null;
        return;
      }
      if (dx < 8) return;
      state.active = true;
      inner.current.setPointerCapture(event.pointerId);
      row.current.dataset.dragging = "";
    }
    state.dx = Math.max(0, dx);
    const width = row.current.offsetWidth;
    inner.current.style.transform = `translateX(${state.dx}px)`;
    row.current.style.setProperty(
      "--reveal",
      String(Math.min(1, state.dx / (width * 0.35))),
    );
    setArmed(state.dx > width * 0.35);
  }
  function pointerEnd() {
    const state = drag.current;
    drag.current = null;
    if (!state?.active || !row.current || !inner.current) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    delete row.current.dataset.dragging;
    if (state.dx > row.current.offsetWidth * 0.35) {
      onComplete(task, row.current, true);
    } else {
      row.current.dataset.returning = "";
      inner.current.style.transform = "";
      row.current.style.setProperty("--reveal", "0");
      setArmed(false);
      setTimeout(() => {
        if (row.current) delete row.current.dataset.returning;
      }, 320);
    }
  }

  return (
    <article
      ref={row}
      className="tl-row"
      data-task-key={`${task.id}:${item.date}`}
      data-done={item.completed || pending ? "" : undefined}
      data-pending={pending ? "" : undefined}
      data-overdue={overdue ? "" : undefined}
      data-armed={armed ? "" : undefined}
    >
      <div className="tl-swipe" aria-hidden="true">
        <Check size={20} />
        Done
      </div>
      <div
        ref={inner}
        className="tl-row-inner"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        {item.projected ? (
          <span
            className="tl-lead"
            title="Future repeat: complete the next due occurrence first"
            aria-label="Future repeat"
          >
            <span className="tl-ring" data-future="">
              <Repeat2 size={12} />
            </span>
          </span>
        ) : locked ? (
          <span className="tl-lead" aria-label="Completed">
            <span className="tl-ring" data-filled="">
              <Check size={13} className="tl-tick" />
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="tl-lead"
            aria-label={
              pending
                ? `Undo completing ${task.title}`
                : `Complete ${task.title}`
            }
            title={pending ? "Undo" : "Complete"}
            onClick={tick}
          >
            <span className="tl-ring">
              <Check size={13} className="tl-tick" />
              <Undo2 size={13} className="tl-undo" />
              <svg className="tl-timer" viewBox="0 0 32 32" aria-hidden="true">
                <circle
                  className="tl-track"
                  cx="16"
                  cy="16"
                  r="15"
                  pathLength={100}
                />
                <circle
                  className="tl-arc"
                  cx="16"
                  cy="16"
                  r="15"
                  pathLength={100}
                />
              </svg>
            </span>
          </button>
        )}
        <button
          type="button"
          className="tl-body"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit(task)}
        >
          <strong className="tl-title">{task.title}</strong>
          <span className="tl-meta">
            {overdue && (
              <span className="tl-due">Due {shortDate(item.date)}</span>
            )}
            {task.kind === "appointment" ? (
              <span>
                <CalendarDays size={13} />
                {task.time || "Appointment"}
              </span>
            ) : (
              task.time && (
                <span>
                  <Clock3 size={13} />
                  {task.time}
                </span>
              )
            )}
            {task.kind === "payment" && (
              <span>
                <CreditCard size={13} />
                Payment
              </span>
            )}
            {task.repeat !== "none" && (
              <span>
                <Repeat2 size={13} />
                {item.projected ? "Future repeat" : repeatText(task)}
              </span>
            )}
            {task.follow_up &&
              !item.completed &&
              (task.follow_up.status === "failed" ? (
                <span
                  className="tl-note"
                  data-failed=""
                  title={task.follow_up.error}
                >
                  <CircleAlert size={13} />
                  Follow-up failed
                </span>
              ) : task.follow_up.proposal ? (
                <span
                  className="tl-note"
                  title={task.follow_up.proposal.message}
                >
                  <Sparkles size={13} />
                  Suggested change
                </span>
              ) : task.follow_up.status === "waiting" ? (
                <span className="tl-note">
                  <Sparkles size={13} />
                  Question in Inbox
                </span>
              ) : null)}
            {item.completed && filter !== "done" && <span>Completed</span>}
          </span>
          <RowTags task={task} />
        </button>
        {money && (
          <span
            className="tl-amount"
            data-amount-tone={money.income ? "income" : "estimate"}
          >
            <MoneyText text={money.text} />
          </span>
        )}
      </div>
    </article>
  );
}

// Slide a row out, then close the gap it leaves (the whole day if it was the
// only task there), then run `after`.
function slideAway(row: HTMLElement, after: () => void) {
  const group = row.closest(".tl-day") as HTMLElement | null;
  const target =
    group && group.querySelectorAll(".tl-row").length === 1 ? group : row;
  const reduced = reducedMotion();
  row.dataset.leaving = "";
  setTimeout(
    () => {
      target.style.height = `${target.offsetHeight}px`;
      target.style.overflow = "hidden";
      target.style.transition = reduced
        ? "none"
        : "height 280ms var(--ease-expressive), margin 280ms var(--ease-expressive), opacity 200ms ease";
      requestAnimationFrame(() => {
        target.style.height = "0px";
        target.style.opacity = "0";
        target.style.marginBottom = "0px";
      });
      setTimeout(after, reduced ? 0 : 290);
    },
    reduced ? 180 : 300,
  );
}

export default function TaskCalendar({
  tasks,
  onEdit,
  onComplete,
  onAdd,
}: {
  tasks: Task[];
  busy?: string;
  onEdit: (task: Task) => void;
  // A dragged completion can still be undone for a moment.
  onComplete: (
    task: Task,
    options?: { undoable?: boolean },
  ) => Promise<boolean>;
  onAdd: (date: string) => void;
}) {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("active");
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  // Rows that slid away stay hidden until the completed task comes back
  // changed (a new version), so nothing flashes back in between.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const grid = useRef<HTMLDivElement>(null);
  const focusDay = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    request<CalendarData>(`/tasks/calendar?month=${month}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, tasks, retry]);
  useEffect(() => {
    if (focusDay.current) {
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focusDay.current}"]`)
        ?.focus();
      focusDay.current = null;
    }
  }, [selected, month]);

  const now = today();
  const days = monthDays(month);
  const calendarItems =
    data?.month === month
      ? data.items.filter((item) => matchesSearch(item.task, search))
      : [];
  const hidden = (task: Task) => gone.has(`${task.id}:${task.version}`);
  const visible = (task: Task) =>
    !!task.date &&
    (!task.plan || task.plan.kind === "scheduled" || task.plan.remind) &&
    !hidden(task);
  const listFor = (view: Filter): Occurrence[] =>
    view === "day"
      ? calendarItems.filter(
          (item) => item.date === selected && !hidden(item.task),
        )
      : tasks
          .filter(
            (task) =>
              visible(task) &&
              matchesSearch(task, search) &&
              (view === "done"
                ? isDone(task)
                : !isDone(task) &&
                  (view !== "today" || task.date <= today(task.timezone))),
          )
          .map((task) => ({
            task,
            date: task.date,
            completed: isDone(task),
            projected: false,
          }));
  const listItems = listFor(filter).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.task.time.localeCompare(b.task.time) ||
      a.task.title.localeCompare(b.task.title),
  );
  // Overdue tasks gather in their own group at the top.
  const groups = Map.groupBy(listItems, (item) =>
    filter !== "done" && filter !== "day" && item.date < now
      ? "overdue"
      : item.date,
  );
  const count = (view: Filter) => listFor(view).length;
  const listPending = filter === "day" && loading && data?.month !== month;
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  const selectedWeekStart = shiftDay(
    selected,
    -((new Date(selected + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  const selectedWeekEnd = shiftDay(selectedWeekStart, 6);
  // The next seven days in one line, instead of a colour legend.
  const week = tasks.filter(
    (task) =>
      visible(task) &&
      !isDone(task) &&
      task.date >= now &&
      task.date <= shiftDay(now, 6),
  );
  const weekCost = week.reduce(
    (sum, task) =>
      !task.income && taskCost(task) ? sum + BigInt(taskCost(task)![1]) : sum,
    0n,
  );

  function select(day: string, focus = false) {
    if (day < "1900-01-01" || day > "9998-12-31") return;
    if (focus) focusDay.current = day;
    setFilter("day");
    setSelected(day);
    setMonth(day.slice(0, 7));
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let next: string;
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    switch (event.key) {
      case "ArrowLeft":
        next = shiftDay(day, -1);
        break;
      case "ArrowRight":
        next = shiftDay(day, 1);
        break;
      case "ArrowUp":
        next = shiftDay(day, -7);
        break;
      case "ArrowDown":
        next = shiftDay(day, 7);
        break;
      case "Home":
        next = shiftDay(day, -weekday);
        break;
      case "End":
        next = shiftDay(day, 6 - weekday);
        break;
      case "PageUp":
        next = shiftMonth(day, -1);
        break;
      case "PageDown":
        next = shiftMonth(day, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next, true);
  }
  function complete(task: Task, row: HTMLElement, dragged = false) {
    const key = `${task.id}:${task.version}`;
    slideAway(row, () => {
      setGone((set) => new Set(set).add(key));
      void onComplete(task, { undoable: dragged }).then((ok) => {
        if (!ok)
          setGone((set) => {
            const next = new Set(set);
            next.delete(key);
            return next;
          });
      });
    });
  }

  const tabs: [Filter, string][] = [
    ["active", "Upcoming"],
    ["today", "Today"],
    ["done", "Done"],
  ];
  return (
    <div className="tasks-workspace">
      <section
        className="tasks-agenda"
        aria-label={filter === "day" ? "Selected day" : "Task list"}
      >
        <div className="tl-tools">
          <SelectionGroup
            enter="left"
            className="segments tl-tabs"
            label="Task view"
            value={filter === "day" ? `day-${selected}` : filter}
          >
            {tabs.map(([value, text]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {text}
                {(value !== "done" || search) && (
                  <span className="tl-count" aria-hidden="true">
                    {count(value)}
                  </span>
                )}
              </button>
            ))}
            {filter === "day" && (
              <span className="tl-day-tab">
                <button aria-pressed="true" onClick={() => setFilter("day")}>
                  <span className="tl-weekday">
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: "short",
                      timeZone: "UTC",
                    }).format(new Date(`${selected}T12:00:00Z`))}{" "}
                  </span>
                  {shortDate(selected)}
                  <span className="tl-count" aria-hidden="true">
                    {count("day")}
                  </span>
                </button>
                <button
                  className="tl-day-close"
                  aria-label="Show all upcoming tasks"
                  title="Show all upcoming tasks"
                  onClick={() => setFilter("active")}
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </SelectionGroup>
          <label
            className="tl-search"
            data-enter="top"
            data-enter-delay="60"
            data-active={search ? "" : undefined}
          >
            <Search size={17} />
            <input
              className="plain-input"
              aria-label="Search tasks"
              placeholder="Search tasks"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="tl-clear"
              aria-label="Clear search"
              tabIndex={search ? 0 : -1}
              onClick={(e) => {
                setSearch("");
                (
                  e.currentTarget.previousElementSibling as HTMLInputElement
                )?.focus();
              }}
            >
              <X size={14} />
            </button>
          </label>
        </div>
        {filter === "day" && error ? (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button
              className="text-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry calendar
            </button>
          </div>
        ) : listPending ? (
          <div className="tasks-empty" role="status">
            <p>Loading your day…</p>
          </div>
        ) : listItems.length === 0 ? (
          <MotionView value={`${filter}-${selected}-${search}`} compact>
            <div className="tasks-empty">
              <span className="tasks-empty-icon">
                {filter === "done" ? (
                  <CheckCheck size={28} />
                ) : (
                  <CalendarDays size={28} />
                )}
              </span>
              <h3>
                {search
                  ? "No matching tasks"
                  : filter === "done"
                    ? "Small wins go here"
                    : filter === "today"
                      ? "All clear for today"
                      : "Nothing planned"}
              </h3>
              {!search && filter !== "done" && (
                <button
                  className="text-button"
                  aria-label={
                    filter === "day" ? "Add task on selected day" : undefined
                  }
                  onClick={() => onAdd(filter === "day" ? selected : today())}
                >
                  <Plus size={16} />
                  Add a task
                </button>
              )}
            </div>
          </MotionView>
        ) : (
          <AnimatedTaskList
            value={`${filter}-${filter === "day" ? selected : ""}`}
          >
            {Array.from(groups, ([key, items]) => {
              const total = dayTotal(items);
              return (
                <section
                  className="tl-day"
                  data-motion-key={`day:${key}`}
                  data-overdue={key === "overdue" ? "" : undefined}
                  key={key}
                  aria-label={key === "overdue" ? "Overdue" : fullDate(key)}
                >
                  {filter !== "day" && (
                    <h2 className="tl-day-heading">
                      <span className="tl-day-label">
                        {key === "overdue" ? "Overdue" : dayHeading(key, now)}
                      </span>
                      {total && (
                        <span className="tl-day-total">
                          {total.cost && (
                            <span data-tone="cost">
                              <MoneyText text={total.cost} />
                            </span>
                          )}
                          {total.cost && total.income && " · "}
                          {total.income && (
                            <span data-tone="income">
                              <MoneyText text={total.income} />
                            </span>
                          )}
                        </span>
                      )}
                    </h2>
                  )}
                  <div className="tl-group">
                    {items.map((item) => (
                      <TaskRow
                        key={`${item.task.id}:${item.date}`}
                        item={item}
                        filter={filter}
                        onEdit={onEdit}
                        onComplete={complete}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {filter === "day" && (
              <button
                className="text-button tl-add-day"
                aria-label="Add task on selected day"
                onClick={() => onAdd(selected)}
              >
                <Plus size={16} />
                Add a task
              </button>
            )}
          </AnimatedTaskList>
        )}
      </section>
      <section
        className={`task-calendar ${mobileExpanded ? "is-expanded" : ""}`}
        data-enter="bottom"
        data-enter-delay="100"
        aria-label="Task calendar"
      >
        <div className="calendar-surface tc-surface">
          <div className="tc-head">
            {/* The month name opens the month picker. */}
            <label className="tc-month">
              <span className="tc-month-name">{label}</span>
              <input
                className="plain-input"
                type="month"
                aria-label="Calendar month"
                value={month}
                min="1900-01"
                max="9998-12"
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker();
                  } catch {
                    // Browsers without showPicker keep their own input behaviour.
                  }
                }}
                onChange={(e) => {
                  if (
                    /^\d{4}-\d{2}$/.test(e.target.value) &&
                    e.target.value >= "1900-01" &&
                    e.target.value <= "9998-12"
                  )
                    select(`${e.target.value}-01`);
                }}
              />
            </label>
            {month !== now.slice(0, 7) && (
              <button
                className="tc-today"
                aria-label="Go to today"
                onClick={() => select(now)}
              >
                Today
              </button>
            )}
            <button
              className="icon-button tc-nav"
              aria-label="Previous month"
              title="Previous month"
              disabled={month === "1900-01"}
              onClick={() => select(shiftMonth(selected, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button tc-nav"
              aria-label="Next month"
              title="Next month"
              disabled={month === "9998-12"}
              onClick={() => select(shiftMonth(selected, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <MotionView value={month} compact>
            <h2 className="sr-only" aria-live="polite">
              {label}
            </h2>
            <div className="calendar-weekdays tc-weekdays" aria-hidden="true">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <span key={index}>{day}</span>
              ))}
            </div>
            <div
              id="task-calendar-grid"
              className="calendar-grid tc-grid"
              ref={grid}
              role="group"
              aria-label={`${label} calendar`}
              aria-busy={loading}
            >
              {days.map((day) => {
                const occurrences = calendarItems.filter(
                  (item) => item.date === day,
                );
                // A daily repeat would dot every day, so it doesn't count here.
                const busy = occurrences.some(
                  (item) =>
                    !(
                      item.task.repeat === "daily" &&
                      (item.task.every ?? 1) === 1
                    ),
                );
                return (
                  <button
                    key={day}
                    data-date={day}
                    data-in-week={
                      day >= selectedWeekStart && day <= selectedWeekEnd
                    }
                    data-outside={day.slice(0, 7) !== month ? "" : undefined}
                    data-past={day < now ? "" : undefined}
                    tabIndex={day === selected ? 0 : -1}
                    aria-pressed={filter === "day" && day === selected}
                    aria-current={day === now ? "date" : undefined}
                    disabled={day < "1900-01-01" || day > "9998-12-31"}
                    aria-label={`${fullDate(day)}, ${occurrences.length} ${occurrences.length === 1 ? "item" : "items"}`}
                    className="calendar-day tc-day"
                    onClick={() => select(day, true)}
                    onKeyDown={(e) => keyDown(e, day)}
                  >
                    {day.slice(0, 7) !== month ? (
                      // A neighbouring month's day is a faint hint: its number
                      // is drawn, not text; the button's label names the date.
                      <span
                        className="calendar-date"
                        data-n={Number(day.slice(8))}
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="calendar-date">
                        {Number(day.slice(8))}
                      </span>
                    )}
                    {busy && <span className="tc-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </MotionView>
          <button
            className="calendar-expand text-button"
            aria-expanded={mobileExpanded}
            aria-controls="task-calendar-grid"
            onClick={() => setMobileExpanded((value) => !value)}
          >
            <ChevronDown size={16} />
            {mobileExpanded ? "Show week" : "Show month"}
          </button>
          <div className="tc-foot">
            <span>
              Next 7 days ·{" "}
              <strong>
                {week.length} {week.length === 1 ? "task" : "tasks"}
              </strong>
            </span>
            {weekCost > 0n && (
              <span data-amount-tone="estimate">
                <MoneyText text={`≈ −${planned(weekCost)}`} />
              </span>
            )}
          </div>
          {error && filter !== "day" && (
            <div className="calendar-error" role="alert">
              <p>{error}</p>
              <button
                className="text-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry calendar
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
