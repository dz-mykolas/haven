import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  CreditCard,
  LoaderCircle,
  Plus,
  Repeat2,
  Search,
  X,
  Sparkles,
  CircleAlert,
} from "lucide-react";
import {
  dateLabel,
  deviceTimezone,
  taskCost,
  costLabel,
  request,
  today,
  type Task,
} from "../lib/api";
import type { components } from "../lib/api.generated";
import { MotionView, SelectionGroup, AnimatedTaskList } from "./Motion";

type CalendarData = components["schemas"]["TaskCalendar"];
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
function monthDays(month: string) {
  const first = new Date(`${month}-01T12:00:00Z`);
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => shiftDay(iso(first), i));
}

export default function TaskCalendar({
  tasks,
  busy,
  onEdit,
  onComplete,
  onAdd,
}: {
  tasks: Task[];
  busy: string;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onAdd: (date: string) => void;
}) {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
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
  const days = monthDays(month);
  const items =
    data?.month === month
      ? data.items.filter((item) =>
          `${item.task.title} ${item.task.notes}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      : [];
  const matches = (task: Task) =>
    `${task.title} ${task.notes}`.toLowerCase().includes(search.toLowerCase());
  const isDone = (task: Task) =>
    task.done ||
    (!!task.date &&
      task.plan?.kind !== "scheduled" &&
      task.plan?.reminder_completed_on === task.date);
  const listItems: CalendarData["items"] =
    filter === "day"
      ? items.filter((item) => item.date === selected)
      : tasks
          .filter(
            (task) =>
              !!task.date &&
              (!task.plan ||
                task.plan.kind === "scheduled" ||
                task.plan.remind) &&
              matches(task) &&
              (filter === "done"
                ? isDone(task)
                : !isDone(task) &&
                  (filter !== "today" || task.date <= today(task.timezone))),
          )
          .map((task) => ({
            task,
            date: task.date,
            completed: isDone(task),
            projected: false,
          }));
  listItems.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.task.time.localeCompare(b.task.time) ||
      a.task.title.localeCompare(b.task.title),
  );
  const groups = Map.groupBy(listItems, (item) => item.date);
  const listTitle =
    filter === "day"
      ? fullDate(selected)
      : filter === "today"
        ? "Today"
        : filter === "done"
          ? "Completed"
          : "Upcoming";
  const listPending = filter === "day" && loading && data?.month !== month;
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  const currentDay = today();
  const selectedWeekStart = shiftDay(
    selected,
    -((new Date(selected + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  const selectedWeekEnd = shiftDay(selectedWeekStart, 6);
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
  return (
    <div className="tasks-workspace">
      <section
        className="tasks-agenda"
        aria-label={filter === "day" ? "Selected day" : "Task list"}
        data-motion-block
      >
        <div className="tasks-list-toolbar">
          <SelectionGroup className="segments" label="Task view" value={filter}>
            {[
              ["active", "Upcoming"],
              ["today", "Today"],
              ["done", "Done"],
            ].map(([value, text]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {text}
              </button>
            ))}
            {filter === "day" && (
              <button aria-pressed="true" onClick={() => setFilter("day")}>
                <CalendarDays size={15} />
                <span>{dateLabel(selected)}</span>
              </button>
            )}
          </SelectionGroup>
          <label className="search tasks-search">
            <Search size={18} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="tasks-list-heading">
          <h2>{listTitle}</h2>
          <span
            className="tasks-count"
            aria-label={`${listItems.length} tasks`}
          >
            {listItems.length}
          </span>
          {filter === "day" && (
            <button
              className="icon-button"
              aria-label="Show all upcoming tasks"
              title="Show all upcoming tasks"
              onClick={() => setFilter("active")}
            >
              <X size={17} />
            </button>
          )}
          <button
            className="icon-button tonal"
            aria-label="Add task on selected day"
            title="Add task"
            onClick={() => onAdd(filter === "day" ? selected : today())}
          >
            <Plus size={20} />
          </button>
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
            <LoaderCircle size={26} className="task-spinner" />
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
            {Array.from(groups, ([date, occurrences]) => (
              <section
                className="tasks-date-group"
                key={date}
                aria-label={fullDate(date)}
              >
                {filter !== "day" && (
                  <h3 className="tasks-date-label">
                    {date === currentDay
                      ? "Today"
                      : date === shiftDay(currentDay, 1)
                        ? "Tomorrow"
                        : dateLabel(date)}
                    <span>{occurrences.length}</span>
                  </h3>
                )}
                {occurrences.map((item) => {
                  const task = item.task;
                  const overdue =
                    !item.completed && item.date < today(task.timezone);
                  return (
                    <article
                      data-task-key={`${task.id}:${item.date}`}
                      className={`agenda-task ${item.completed ? "done" : ""} ${busy === task.id ? "is-saving" : ""}`}
                      key={`${task.id}:${item.date}`}
                    >
                      {item.completed ? (
                        <span
                          className="complete-button completed"
                          aria-label="Completed"
                        >
                          <Check size={21} />
                        </span>
                      ) : item.projected ? (
                        <span
                          className="complete-button future-repeat"
                          title="Future repeat: complete the next due occurrence first"
                          aria-label="Future repeat"
                        >
                          <Repeat2 size={21} />
                        </span>
                      ) : (
                        <button
                          className="complete-button"
                          aria-label={`Complete ${task.title}`}
                          title="Complete occurrence"
                          disabled={!!busy || (filter === "day" && loading)}
                          onClick={() => onComplete(task)}
                        >
                          {busy === task.id ? (
                            <LoaderCircle className="task-spinner" size={21} />
                          ) : (
                            <Circle size={22} />
                          )}
                        </button>
                      )}
                      <button
                        className="task-content"
                        aria-label={`Edit ${task.title}`}
                        onClick={() => onEdit(task)}
                      >
                        <strong>{task.title}</strong>
                        <span className="task-meta">
                          {overdue && (
                            <span className="due-label overdue">Overdue</span>
                          )}
                          <span>
                            <CalendarDays size={13} />
                            {dateLabel(item.date)}
                          </span>
                          {task.time && (
                            <span title={task.timezone}>
                              <Clock3 size={13} />
                              {task.time}
                              {task.timezone !== deviceTimezone()
                                ? ` · ${task.timezone}`
                                : ""}
                            </span>
                          )}
                          {task.repeat !== "none" && (
                            <span
                              title={
                                item.projected
                                  ? "Editing changes the repeating task"
                                  : undefined
                              }
                            >
                              <Repeat2 size={13} />
                              {item.projected
                                ? "Future repeat"
                                : task.routine
                                  ? `${task.repeat} routine`
                                  : task.repeat}
                            </span>
                          )}
                          {task.follow_up &&
                            !item.completed &&
                            (task.follow_up.status === "failed" ? (
                              <span
                                className="task-follow-up"
                                data-failed
                                title={task.follow_up.error}
                              >
                                <CircleAlert size={13} />
                                Follow-up failed
                              </span>
                            ) : task.follow_up.status === "waiting" ? (
                              <span className="task-follow-up">
                                <Sparkles size={13} />
                                Question in Inbox
                              </span>
                            ) : task.follow_up.summary ? (
                              <span
                                className="task-follow-up"
                                title={task.follow_up.summary}
                              >
                                <Sparkles size={13} />
                                <span>{task.follow_up.summary}</span>
                              </span>
                            ) : null)}
                          {(task.kind === "payment" || taskCost(task)) && (
                            <span>
                              <CreditCard size={13} />
                              {taskCost(task) ? (
                                <span data-amount-tone="estimate">
                                  {costLabel(...taskCost(task)!)}
                                </span>
                              ) : (
                                "Payment"
                              )}
                            </span>
                          )}
                          {item.completed && <span>Completed</span>}
                        </span>
                      </button>
                      <span
                        className={`task-kind ${task.kind}`}
                        title={
                          task.kind === "payment"
                            ? "Payment reminder"
                            : task.kind === "appointment"
                              ? "Appointment"
                              : "Task"
                        }
                      >
                        {task.kind === "payment" ? (
                          <CreditCard size={18} />
                        ) : task.kind === "appointment" ? (
                          <CalendarDays size={18} />
                        ) : (
                          <CheckCheck size={18} />
                        )}
                      </span>
                    </article>
                  );
                })}
              </section>
            ))}
          </AnimatedTaskList>
        )}
      </section>
      <section
        className={`task-calendar ${mobileExpanded ? "is-expanded" : ""}`}
        aria-label="Task calendar"
        data-motion-block
      >
        <div className="calendar-surface">
          <div className="calendar-topline">
            <span className="eyebrow">YOUR SCHEDULE</span>
            <button className="text-button" onClick={() => select(today())}>
              Go to today
            </button>
          </div>
          <div className="calendar-month-controls">
            <label className="calendar-month">
              <span className="sr-only">Calendar month</span>
              <input
                type="month"
                value={month}
                min="1900-01"
                max="9998-12"
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
            <button
              className="icon-button"
              aria-label="Previous month"
              title="Previous month"
              disabled={month === "1900-01"}
              onClick={() => select(shiftMonth(selected, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
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
            <div className="calendar-weekdays" aria-hidden="true">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <span key={index}>{day}</span>
              ))}
            </div>
            <div
              id="task-calendar-grid"
              className="calendar-grid"
              ref={grid}
              role="group"
              aria-label={`${label} calendar`}
              aria-busy={loading}
            >
              {days.map((day) => {
                const occurrences = items.filter((item) => item.date === day);
                return (
                  <button
                    key={day}
                    data-date={day}
                    data-in-week={
                      day >= selectedWeekStart && day <= selectedWeekEnd
                    }
                    tabIndex={day === selected ? 0 : -1}
                    aria-pressed={filter === "day" && day === selected}
                    aria-current={day === currentDay ? "date" : undefined}
                    disabled={day < "1900-01-01" || day > "9998-12-31"}
                    aria-label={`${fullDate(day)}, ${occurrences.length} ${occurrences.length === 1 ? "item" : "items"}`}
                    className={`calendar-day ${day.slice(0, 7) !== month ? "outside-month" : ""}`}
                    onClick={() => select(day, true)}
                    onKeyDown={(e) => keyDown(e, day)}
                  >
                    <span className="calendar-date">
                      {Number(day.slice(8))}
                    </span>
                    <span className="calendar-dots" aria-hidden="true">
                      {occurrences.slice(0, 3).map((item) => (
                        <span
                          key={item.task.id}
                          className={
                            item.completed ? "completed" : item.task.kind
                          }
                        />
                      ))}
                    </span>
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
          <div className="calendar-legend" aria-label="Calendar markers">
            <span>
              <i />
              Tasks
            </span>
            <span>
              <i className="appointment" />
              Appointments
            </span>
            <span>
              <i className="payment" />
              Payments
            </span>
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
