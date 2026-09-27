import BrandIcon from "./BrandIcon";
import { useActivity } from "./useActivity";
import { useState } from "react";
import {
  Plus,
  SlidersHorizontal,
  Pencil,
  Tv,
  Music2,
  Cloud,
  Phone,
  Home,
  Flame,
  Droplets,
  ShieldCheck,
  Gamepad2,
  Bus,
  Dumbbell,
  CreditCard,
  Link2,
  Check,
  CalendarClock,
  CalendarCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Input } from "./ui/input";
import Disclosure from "./Disclosure";
import FormSelect from "./FormSelect";
import UpcomingTimeline, { Row, type Item } from "./UpcomingTimeline";
import {
  costLabel,
  dateLabel,
  money,
  request,
  type Snapshot,
  type Task,
} from "../lib/api";
import { newTask, type EditorState } from "./Editor";

export function defaultPlan(task: Task): NonNullable<Task["plan"]> {
  return (
    task.plan ?? {
      kind: "scheduled",
      excluded: false,
      remind: false,
      expires_on: "",
      date_until: "",
      interval_days: 0,
      coverage_days: 0,
      coverage_through: "",
      quantity: 1,
    }
  );
}
function PlanIcon({ title, size = 19 }: { title: string; size?: number }) {
  const icons: [RegExp, typeof Home][] = [
    [/netflix|disney|cinema/i, Tv],
    [/spotify|music/i, Music2],
    [/icloud|storage/i, Cloud],
    [/telia|bitė|phone/i, Phone],
    [/rent|apartment/i, Home],
    [/ignitis|heating|šilumos/i, Flame],
    [/water|vanden/i, Droplets],
    [/insurance|draudim/i, ShieldCheck],
    [/genshin|welkin|wuwa|wuthering|battle.?pass/i, Gamepad2],
    [/judu|transport/i, Bus],
    [/gym|fitness/i, Dumbbell],
  ];
  const Icon = icons.find(([pattern]) => pattern.test(title))?.[1];
  return (
    <BrandIcon
      name={title}
      size={size}
      fallback={
        Icon ? (
          <Icon size={size} aria-hidden="true" />
        ) : (
          <span className="plan-initial" aria-hidden="true">
            {title.trim().slice(0, 2).toUpperCase()}
          </span>
        )
      }
    />
  );
}
function timing(item: Item, from: string) {
  if (!item.date) return "Timing unknown";
  if (item.event === "expiry") {
    const days = Math.round(
      (Date.parse(item.date) - Date.parse(from)) / 86400000,
    );
    return days <= 0 ? "Expires today" : `Expires in ${days} days`;
  }
  if (item.date_until && item.date_until !== item.date)
    return `${dateLabel(item.date)} – ${dateLabel(item.date_until)}`;
  return dateLabel(item.date);
}
function price(item: Item) {
  return item.minimum_minor == null || item.maximum_minor == null
    ? "—"
    : costLabel(item.minimum_minor, item.maximum_minor);
}
// Including or leaving out a plan from the estimate.
function useInclude(onRefresh: () => Promise<void>) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function include(task: Task, checked: boolean) {
    setBusy(task.id);
    setError("");
    try {
      await request(`/tasks/${task.id}`, {
        ...task,
        plan: { ...defaultPlan(task), excluded: !checked },
      });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return { busy, error, include };
}

// Managing and adding plans: two buttons, and the plans dialog.
export function PlanActions({
  data,
  onEdit,
  onRefresh,
}: {
  data: Snapshot;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
}) {
  const [manage, setManage] = useState(false);
  const { busy, error, include } = useInclude(onRefresh);
  return (
    <div className="forecast-actions">
      <Button
        variant="ghost"
        size="icon"
        className="icon-button"
        aria-label="Manage payment plans"
        title="Manage payment plans"
        onClick={() => setManage(true)}
      >
        <SlidersHorizontal size={18} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="icon-button"
        aria-label="Add upcoming payment"
        title="Add upcoming payment"
        onClick={() => {
          const editor = newTask();
          if (editor.type === "task") editor.record.kind = "payment";
          onEdit(editor);
        }}
      >
        <Plus size={20} />
      </Button>
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent
          className="forecast-manager"
          aria-describedby="forecast-manager-description"
        >
          <DialogHeader>
            <DialogTitle>Payment plans</DialogTitle>
            <DialogDescription id="forecast-manager-description">
              All active plans, including those beyond 30 days.
            </DialogDescription>
          </DialogHeader>
          <div className="forecast-manager-list">
            {data.tasks
              .filter((t) => t.kind === "payment" && !t.done && !t.deleted)
              .map((task) => (
                <div className="forecast-breakdown-row" key={task.id}>
                  <Button
                    variant="ghost"
                    className="forecast-item-button"
                    aria-label={`Edit ${task.title} plan`}
                    onClick={() => {
                      setManage(false);
                      onEdit({ type: "task", record: task });
                    }}
                  >
                    <PlanIcon title={task.title} />
                    <span className="forecast-chip-name">
                      <span>{task.title}</span>
                      <small>
                        {task.plan?.expires_on
                          ? `Coverage ends ${dateLabel(task.plan.expires_on)}`
                          : task.date
                            ? dateLabel(task.date)
                            : "Timing unknown"}
                      </small>
                    </span>
                    <span
                      className="forecast-chip-price"
                      data-amount-tone="estimate"
                    >
                      {task.estimated_min_minor != null &&
                      task.estimated_max_minor != null
                        ? costLabel(
                            task.estimated_min_minor,
                            task.estimated_max_minor,
                          )
                        : Number(task.amount_minor) > 0
                          ? money(task.amount_minor)
                          : "—"}
                    </span>
                  </Button>
                  <Switch
                    aria-label={`Include ${task.title} in estimated spending`}
                    checked={!task.plan?.excluded}
                    disabled={!!busy}
                    onCheckedChange={(checked) => void include(task, checked)}
                  />
                </div>
              ))}
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The next 30 days inside the Money overview: a timeline of plans, each
// opening its details. The overview itself shows the 30-day total.
export default function UpcomingCosts({
  data,
  onEdit,
  onRefresh,
}: {
  data: Snapshot;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
}) {
  const { busy, error, include } = useInclude(onRefresh);
  // The payment whose details are open keeps its column open.
  const [opened, setOpened] = useState("");
  const upcoming = data.upcoming;
  if (!upcoming) return null;
  const toggle = (item: Item) => (
    <Switch
      aria-label={`Include ${item.task.title} in estimated spending`}
      checked={item.included}
      disabled={!!busy}
      onCheckedChange={(checked) => void include(item.task, checked)}
    />
  );
  const key = (item: Item) => `${item.task.id}:${item.date}`;
  const wrap = (item: Item, trigger: React.ReactNode) => (
    <PlanDetails
      key={key(item)}
      item={item}
      data={data}
      onEdit={onEdit}
      onRefresh={onRefresh}
      toggle={toggle(item)}
      onOpenChange={(open) =>
        setOpened((current) =>
          open ? key(item) : current === key(item) ? "" : current,
        )
      }
    >
      {trigger}
    </PlanDetails>
  );
  const icon = (item: Item) => <PlanIcon title={item.task.title} size={16} />;
  const undated = upcoming.items.filter((item) => !item.date);
  return (
    <section className="overview-upcoming" aria-label="Upcoming costs">
      <header className="overview-section-heading">
        <h3>
          <CalendarClock size={16} aria-hidden="true" />
          <span>Next 30 days</span>
        </h3>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {upcoming.items.length > 0 ? (
        <>
          <UpcomingTimeline
            items={upcoming.items}
            from={upcoming.from}
            icon={icon}
            wrap={wrap}
            held={!!opened}
          />
          {undated.length > 0 && (
            <section className="timeline-undated" aria-label="No date yet">
              <header>No date yet</header>
              {undated.map((item) => (
                <Row
                  key={key(item)}
                  item={item}
                  from={upcoming.from}
                  icon={icon(item)}
                  wrap={wrap}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <p className="overview-empty">
          <CalendarCheck size={18} aria-hidden="true" />
          Nothing planned
        </p>
      )}
    </section>
  );
}

function PlanDetails({
  item,
  data,
  onEdit,
  onRefresh,
  toggle,
  children,
  onOpenChange,
}: {
  item: Item;
  data: Snapshot;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
  toggle: React.ReactNode;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [entryID, setEntryID] = useState("");
  const [units, setUnits] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = item.task.plan;
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const linkedQuery = useActivity({ payment: item.task.id }, open);
  const purchaseQuery = useActivity(
    { unlinked: "true", search: purchaseSearch },
    open,
  );
  const linked = linkedQuery.entries;
  const available = purchaseQuery.entries;
  async function link() {
    const entry = available.find((e) => e.id === entryID);
    if (!entry) return;
    setBusy(true);
    setError("");
    try {
      const annotations = {
        category_id: entry.category_id ?? "",
        tags: entry.tags,
        notes: entry.notes,
        version: entry.version,
        payment: item.task,
        payment_units: Number(units),
      };
      if (entry.source)
        await request(
          `/banking/transactions/${entry.id}/annotations`,
          annotations,
        );
      else await request(`/entries/${entry.id}`, { ...entry, ...annotations });
      setEntryID("");
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="forecast-popover"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        aria-label={`${item.task.title} details`}
      >
        <div className="forecast-detail-heading">
          <PlanIcon title={item.task.title} />
          <h3>{item.task.title}</h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${item.task.title} plan`}
            onClick={() => {
              setOpen(false);
              onEdit({ type: "task", record: item.task });
            }}
          >
            <Pencil size={16} />
          </Button>
        </div>
        <div className="forecast-detail-price">
          <strong data-amount-tone="estimate">{price(item)}</strong>
          <span>
            {item.group === "expected"
              ? "Expected purchase"
              : "Scheduled payment"}
          </span>
        </div>
        <dl className="forecast-facts">
          <div>
            <dt>{item.event === "expiry" ? "Coverage" : "Next payment"}</dt>
            <dd>{timing(item, data.upcoming!.from)}</dd>
          </div>
          {plan?.kind === "prepaid" && (
            <>
              <div>
                <dt>Per purchase</dt>
                <dd>
                  {plan.quantity} × {plan.coverage_days || "?"} days
                </dd>
              </div>
              {plan.expires_on && item.event !== "expiry" && (
                <div>
                  <dt>Coverage ends</dt>
                  <dd>{dateLabel(plan.expires_on)}</dd>
                </div>
              )}
              {!plan.expires_on && (
                <div>
                  <dt>Expiry</dt>
                  <dd>Unknown</dd>
                </div>
              )}
            </>
          )}
          {item.task.repeat !== "none" && (
            <div>
              <dt>Repeats</dt>
              <dd>{item.task.repeat}</dd>
            </div>
          )}
        </dl>
        <label className="forecast-include">
          <span>Include in estimate</span>
          {toggle}
        </label>
        <Disclosure
          className="forecast-transactions"
          title={
            <span>
              <CreditCard size={15} /> {linkedQuery.total} linked{" "}
              {linkedQuery.total === 1 ? "purchase" : "purchases"}
            </span>
          }
        >
          {linked.slice(0, 12).map((entry) => (
            <button
              type="button"
              className="forecast-linked-entry"
              key={entry.id}
              onClick={() => {
                setOpen(false);
                onEdit({ type: "entry", record: entry });
              }}
            >
              <span>{dateLabel(entry.date)}</span>
              <strong data-amount-tone="spending">
                {money(entry.amount_minor)}
              </strong>
            </button>
          ))}
          {linkedQuery.isPending ? (
            <p role="status" className="helper">
              Loading purchases…
            </p>
          ) : linkedQuery.error ? (
            <p role="alert" className="form-error">
              {linkedQuery.error.message}
            </p>
          ) : (
            !linked.length && <p className="helper">No purchases linked yet.</p>
          )}
        </Disclosure>
        {plan && plan.kind !== "scheduled" && (
          <Disclosure
            title={
              <span>
                <Link2 size={15} /> Link a purchase
              </span>
            }
          >
            <p className="helper">
              Confirm the product and quantity.
              {plan.coverage_through
                ? ` Purchases through ${dateLabel(plan.coverage_through)} are already included in coverage.`
                : ""}
            </p>
            <Input
              aria-label="Search purchases to link"
              placeholder="Search purchases…"
              value={purchaseSearch}
              onChange={(event) => {
                setPurchaseSearch(event.target.value);
                setEntryID("");
              }}
            />
            {purchaseQuery.error && (
              <p role="alert" className="form-error">
                {purchaseQuery.error.message}
              </p>
            )}
            <FormSelect
              aria-label="Purchase to link"
              value={entryID}
              onChange={(e) => setEntryID(e.target.value)}
            >
              <option value="">Choose transaction</option>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.payee} · {dateLabel(entry.date)} ·{" "}
                  {money(entry.amount_minor)}
                </option>
              ))}
            </FormSelect>
            <label className="field">
              <span>Quantity purchased</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
            </label>
            <Button
              disabled={
                busy || !entryID || Number(units) < 1 || Number(units) > 100
              }
              onClick={() => void link()}
            >
              <Check size={16} /> Link purchase
            </Button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </Disclosure>
        )}
      </PopoverContent>
    </Popover>
  );
}
