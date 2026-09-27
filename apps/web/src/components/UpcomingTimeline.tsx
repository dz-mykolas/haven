import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AlarmClock, Clock3 } from "lucide-react";
import { useBrand } from "./BrandIcon";
import MoneyText from "./MoneyText";
import { costLabel, type Snapshot } from "../lib/api";

export type Item = NonNullable<Snapshot["upcoming"]>["items"][number];
type Wrap = (item: Item, trigger: ReactNode) => ReactNode;
type Point = { item: Item; days: number; min: number; max: number };

const DAYS = 30;
const weeks = [
  { from: 0, to: 6 },
  { from: 7, to: 13 },
  { from: 14, to: 20 },
  { from: 21, to: DAYS },
];

export function shiftISO(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function daysUntil(date: string, from: string) {
  return Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86400000,
  );
}
const format = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
// "Wed 14 Oct"
const weekday = (iso: string) =>
  format(iso, { weekday: "short", day: "numeric", month: "short" });
// "13–15 Oct" or "30 Sep – 2 Oct"
function span(a: string, b: string) {
  if (a === b) return weekday(a);
  return format(a, { month: "short" }) === format(b, { month: "short" })
    ? `${format(a, { day: "numeric" })}–${format(b, { day: "numeric", month: "short" })}`
    : `${format(a, { day: "numeric", month: "short" })} – ${format(b, { day: "numeric", month: "short" })}`;
}
const whole = (minor: number) =>
  `€${Math.round(minor / 100).toLocaleString("en-IE")}`;
// A column's amount: exact when every price is known and fixed, otherwise
// "about" the most it could come to. Income is shown apart from costs.
function short(points: Point[]) {
  const sum = (list: Point[]) => {
    const lo = list.reduce((a, p) => a + p.min, 0),
      hi = list.reduce((a, p) => a + p.max, 0);
    return lo === hi ? whole(lo) : `≈ ${whole(hi)}`;
  };
  const costs = points.filter((p) => !p.item.task.income),
    income = points.filter((p) => p.item.task.income);
  return [costs.length ? sum(costs) : "", income.length ? `+${sum(income)}` : ""]
    .filter(Boolean)
    .join(" · ");
}
function price(item: Item) {
  return item.minimum_minor == null || item.maximum_minor == null
    ? "—"
    : costLabel(item.minimum_minor, item.maximum_minor);
}
export function when(item: Item, from: string) {
  if (!item.date) return "Timing unknown";
  const days = daysUntil(item.date, from);
  const soon =
    days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return item.event === "expiry"
    ? `Coverage ends ${weekday(item.date)}, ${soon}`
    : `${weekday(item.date)}, ${soon}`;
}

// Each payment's colour: its brand's, or one for its kind of payment.
const kinds: [RegExp, string][] = [
  [/rent|apartment/i, "#8a6cf0"],
  [/judu|transport|bus/i, "#2d9cdb"],
  [/gym|fitness/i, "#f07a3c"],
  [/telia|bitė|phone/i, "#26a69a"],
  [/ignitis|heating|šilumos/i, "#f2a33a"],
  [/water|vanden/i, "#3bb5e0"],
  [/insurance|draudim/i, "#5b7bd6"],
];
function useTint(title: string) {
  const { data } = useBrand(title);
  return data
    ? `#${data.hex}`
    : (kinds.find(([pattern]) => pattern.test(title))?.[1] ?? "#c06c9e");
}

// Due soon: an alarm clock on the icon's corner. Yellow within a week; red
// within three days, with a short rattle every few seconds.
function Soon({ days }: { days: number }) {
  if (days > 7) return null;
  return (
    <span className="soon-badge" data-now={days <= 3 || undefined}>
      <AlarmClock aria-hidden="true" />
    </span>
  );
}

function Mark({
  point,
  from,
  icon,
  wrap,
}: {
  point: Point;
  from: string;
  icon: ReactNode;
  wrap: Wrap;
}) {
  const { item, days } = point;
  const tint = useTint(item.task.title);
  return wrap(
    item,
    <button
      type="button"
      className="pt"
      data-excluded={!item.included}
      style={{ "--tint": tint } as CSSProperties}
      aria-label={`Details for ${item.task.title}, ${when(item, from)}, ${price(item)}`}
    >
      <span className="label" aria-hidden="true" />
      <span className="more" aria-hidden="true" />
      <span className="ic">
        {icon}
        <Soon days={days} />
      </span>
      <span className="stem" aria-hidden="true" />
      <span className="tip" aria-hidden="true">
        <strong>{item.task.title}</strong>
        <span>
          <MoneyText text={price(item)} /> · {when(item, from)}
        </span>
      </span>
    </button>,
  );
}

export function Row({
  item,
  from,
  icon,
  wrap,
}: {
  item: Item;
  from: string;
  icon: ReactNode;
  wrap: Wrap;
}) {
  const days = item.date ? Math.max(0, daysUntil(item.date, from)) : null;
  const tint = useTint(item.task.title);
  return wrap(
    item,
    <button
      type="button"
      className="vrow"
      data-excluded={!item.included}
      style={{ "--tint": tint } as CSSProperties}
      aria-label={`Details for ${item.task.title}, ${when(item, from)}, ${price(item)}`}
    >
      {days !== null && (
        <span className="due" aria-hidden="true">
          <Clock3 />
          {days <= 0 ? "Today" : `${days}d`}
        </span>
      )}
      <span className="ic">
        {icon}
        {days !== null && <Soon days={days} />}
      </span>
      <span className="name">{item.task.title}</span>
      <span
        className="price"
        data-amount-tone={item.task.income ? "income" : "estimate"}
      >
        <MoneyText text={(item.task.income ? "+" : "") + price(item)} />
      </span>
    </button>,
  );
}

// Next 30 days. Wide: payments stand in columns on a 30-day line; pointing
// at a column opens it along the line, each payment over its own date,
// while the rest compress aside. Narrow: a vertical timeline of weeks.
export default function UpcomingTimeline({
  items,
  from,
  icon,
  wrap,
  held,
}: {
  items: Item[];
  from: string;
  icon: (item: Item) => ReactNode;
  wrap: Wrap;
  held: boolean;
}) {
  const wide = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof timeline> | null>(null);
  const points: Point[] = items
    .filter((item) => item.date)
    .map((item) => ({
      item,
      days: Math.min(DAYS, Math.max(0, daysUntil(item.date, from))),
      min: Number(item.minimum_minor ?? 0),
      max: Number(item.maximum_minor ?? 0),
    }))
    .sort((a, b) => a.days - b.days);
  const signature = points
    .map((p) => `${p.item.task.id}:${p.days}:${p.min}:${p.max}`)
    .join("|");
  useLayoutEffect(() => {
    if (!wide.current) return;
    engine.current = timeline(wide.current, points, from);
    return () => engine.current?.destroy();
    // The layout depends only on where and how much each payment is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, from]);
  useLayoutEffect(() => engine.current?.hold(held), [held]);
  return (
    <>
      <div className="timeline-wide" ref={wide}>
        <div
          className="timeline-lanes"
          role="group"
          aria-label="Upcoming plans"
        >
          {points.map((point) => (
            <Mark
              key={`${point.item.task.id}:${point.item.date}`}
              point={point}
              from={from}
              icon={icon(point.item)}
              wrap={wrap}
            />
          ))}
        </div>
        <div className="timeline-axis" aria-hidden="true">
          <span className="line" />
          {[0, 7, 14, 21, DAYS].map((day) => (
            <i key={day} />
          ))}
        </div>
        <div className="timeline-cap" aria-hidden="true">
          <div className="cap-in">
            <strong />
            <span />
          </div>
        </div>
        <div className="timeline-weeks" aria-hidden="true">
          {weeks.map((w) => (
            <div key={w.from}>
              <small>
                {w.from === 0
                  ? "Today"
                  : format(shiftISO(from, w.from), {
                      day: "numeric",
                      month: "short",
                    })}
              </small>
            </div>
          ))}
        </div>
      </div>
      <div className="timeline-narrow">
        {weeks.map((w, index) => {
          const list = points.filter((p) => p.days >= w.from && p.days <= w.to);
          if (!list.length) return null;
          return (
            <section
              key={w.from}
              className="timeline-week"
              style={
                { "--dot": `${[100, 60, 35, 20][index]}%` } as CSSProperties
              }
              aria-label={
                w.from === 0
                  ? "This week"
                  : `From ${weekday(shiftISO(from, w.from))}`
              }
            >
              <header>
                <span>
                  {w.from === 0
                    ? "This week"
                    : `From ${weekday(shiftISO(from, w.from))}`}
                </span>
                <strong>{short(list)}</strong>
              </header>
              {list.map((p) => (
                <Row
                  key={`${p.item.task.id}:${p.item.date}`}
                  item={p.item}
                  from={from}
                  icon={icon(p.item)}
                  wrap={wrap}
                />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

// The wide layout, worked imperatively so every move is a CSS transition:
// one persistent element per payment, positioned by transform.
function timeline(root: HTMLElement, points: Point[], from: string) {
  const lanes = root.querySelector<HTMLElement>(".timeline-lanes")!;
  const marks = [...lanes.querySelectorAll<HTMLElement>(".pt")];
  const cap = root.querySelector<HTMLElement>(".timeline-cap")!;
  const ticks = [...root.querySelectorAll<HTMLElement>(".timeline-axis i")];
  const line = root.querySelector<HTMLElement>(".timeline-axis .line")!;
  const weekEls = [
    ...root.querySelectorAll<HTMLElement>(".timeline-weeks > div"),
  ];
  const all = points.map((_, i) => i);
  const pick = (c: number[]) => c.map((i) => points[i]);
  // Room a column needs: its icons or its amount, whichever is wider.
  const footprint = (list: Point[]) =>
    Math.max(38, short(list).length * 7.5 + 8);
  const rowWidth = (list: Point[]) =>
    list.reduce((a, p) => a + footprint([p]), 0) + (list.length - 1) * 8;
  const byDay = (list: number[]) => {
    const map = new Map<number, number[]>();
    for (const i of list)
      map.set(points[i].days, [...(map.get(points[i].days) ?? []), i]);
    return map;
  };
  type Block = { c: number[]; x: number; w: number; row?: boolean };

  // Neighbouring payments merge into one column while they would overlap.
  function columns(at: (days: number) => number) {
    const center = (c: number[]) =>
      c.reduce((a, i) => a + at(points[i].days), 0) / c.length;
    const clusters = all.map((i) => [i]);
    for (let merged = true; merged;) {
      merged = false;
      for (let k = 0; k < clusters.length - 1; k++) {
        const a = clusters[k],
          b = clusters[k + 1];
        if (
          center(a) + footprint(pick(a)) / 2 + 6 >
          center(b) - footprint(pick(b)) / 2
        ) {
          clusters.splice(k, 2, [...a, ...b]);
          merged = true;
          break;
        }
      }
    }
    return clusters;
  }
  const gap = 10;
  // Keep blocks in order and clear of each other within [from, to]; with too
  // little room, spread them evenly across what there is.
  function fit(list: Block[], lo: number, hi: number) {
    if (!list.length) return;
    const need = list.reduce((a, b) => a + b.w, 0) + gap * (list.length - 1);
    if (need > hi - lo) {
      const step =
        list.length > 1
          ? (hi - lo - list[0].w / 2 - list.at(-1)!.w / 2) / (list.length - 1)
          : 0;
      list.forEach(
        (b, k) =>
          (b.x =
            list.length > 1 ? lo + list[0].w / 2 + k * step : (lo + hi) / 2),
      );
      return;
    }
    for (let k = 0; k < list.length; k++) {
      const min =
        (k ? list[k - 1].x + list[k - 1].w / 2 + gap : lo) + list[k].w / 2;
      if (list[k].x < min) list[k].x = min;
    }
    for (let k = list.length - 1; k >= 0; k--) {
      const max =
        (k < list.length - 1 ? list[k + 1].x - list[k + 1].w / 2 - gap : hi) -
        list[k].w / 2;
      if (list[k].x > max) list[k].x = max;
    }
  }

  let width = 0;
  // The opened column, and where it stood at rest (it opens from there).
  let group: number[] | null = null,
    anchor = 0;
  // Columns are fixed: worked out from the resting timeline, and again only
  // when the width changes, never while hovering.
  let groups: number[][] = [],
    groupsWidth = 0,
    restX = new Map<number[], number>();
  const now = points.map(() => 0);
  let drawn: number[][] = [];

  function place(
    i: number,
    x: number,
    slot: number,
    o: {
      top: boolean;
      base: boolean;
      crowded?: boolean;
      label?: string;
      scale?: number;
      lift?: number;
    },
  ) {
    const el = marks[i];
    const scale = o.scale ?? 1,
      lift = o.lift ?? 0;
    el.style.transform = `translate(${x}px, ${-slot * 28}px) scale(${scale})`;
    now[i] = x;
    // Stem length in the mark's own (scaled) units, so it ends on the line.
    el.style.setProperty("--stem", `${(39 + lift) / scale - 19}px`);
    el.toggleAttribute("data-top", o.top);
    el.toggleAttribute("data-base", o.base);
    el.toggleAttribute("data-more", !!o.crowded);
    el.querySelector(".label")!.textContent = o.label ?? "";
  }

  // The zoom is a lens around the opened column's dates: inside it, days get
  // just enough room for every payment to stand over its own date; the days
  // before and after compress evenly into what is left on each side.
  function lens() {
    const base = width / DAYS;
    if (!group) return (days: number) => days * base;
    const days = byDay(group);
    const dates = [...days.keys()].sort((a, b) => a - b);
    let k = base * 1.25;
    for (let n = 1; n < dates.length; n++) {
      const need =
        (rowWidth(pick(days.get(dates[n - 1])!)) +
          rowWidth(pick(days.get(dates[n])!))) /
          2 +
        12;
      k = Math.max(k, need / (dates[n] - dates[n - 1]));
    }
    const L = Math.max(dates[0] - 1, 0),
      R = Math.min(dates.at(-1)! + 1, DAYS);
    const side = 60;
    k = Math.min(
      k,
      (width - (L > 0 ? side : 0) - (R < DAYS ? side : 0)) / (R - L),
    );
    // The column parts to both sides of where it stood, its middle payment
    // (the earlier of two) staying there.
    const order = dates.flatMap((d) => days.get(d)!);
    const p = order[Math.floor((order.length - 1) / 2)],
      mates = days.get(points[p].days)!;
    const within = mates
      .slice(0, mates.indexOf(p))
      .reduce((a, q) => a + footprint([points[q]]) + 8, 0);
    const pivot =
      (points[p].days - L) * k -
      rowWidth(pick(mates)) / 2 +
      within +
      footprint([points[p]]) / 2;
    let Lx = anchor - pivot;
    Lx = Math.min(
      Math.max(Lx, L > 0 ? side : 0),
      width - k * (R - L) - (R < DAYS ? side : 0),
    );
    const Rx = Lx + k * (R - L);
    return (d: number) =>
      d < L
        ? (d / L) * Lx
        : d > R
          ? Rx + ((d - R) / (DAYS - R)) * (width - Rx)
          : Lx + (d - L) * k;
  }

  function render() {
    width = lanes.clientWidth;
    if (!width) return;
    const at = lens();
    const capOpen = root.hasAttribute("data-zoomed");
    root.toggleAttribute("data-zoomed", !!group);
    const blocks: Block[] = [];
    drawn = group ? [group] : [];
    if (group) {
      // Every payment of the opened column over its own date; same-day
      // payments side by side.
      let lo = Infinity,
        hi = -Infinity;
      for (const [day, list] of byDay(group)) {
        let left = at(day) - rowWidth(pick(list)) / 2;
        for (const i of list) {
          const w = footprint([points[i]]);
          const x = left + w / 2;
          left += w + 8;
          lo = Math.min(lo, x - w / 2);
          hi = Math.max(hi, x + w / 2);
          marks[i].removeAttribute("data-hidden");
          marks[i].removeAttribute("aria-disabled");
          marks[i].classList.add("focus");
          place(i, x, 0, {
            top: true,
            base: true,
            label: short([points[i]]),
            scale: 1.12,
          });
        }
      }
      blocks.push({ c: group, row: true, x: (lo + hi) / 2, w: hi - lo });
      // Under the line: the opened column's total and dates.
      const dates = group.map((i) => points[i].days);
      cap.querySelector("strong")!.textContent = short(pick(group));
      cap.querySelector("span")!.textContent = span(
        shiftISO(from, Math.min(...dates)),
        shiftISO(from, Math.max(...dates)),
      );
      const half = cap.offsetWidth / 2;
      // Between columns it slides; arriving from outside it appears in place.
      if (!capOpen) cap.style.transition = "none";
      cap.style.transform = `translateX(${Math.min(Math.max((lo + hi) / 2, half), width - half)}px) translateX(-50%)`;
      if (!capOpen) {
        void cap.offsetWidth;
        cap.style.transition = "";
      }
    }
    if (groupsWidth !== width) {
      groups = columns((days) => (days / DAYS) * width);
      const rest = groups.map((c) => ({
        c,
        x:
          c.reduce((a, i) => a + (points[i].days / DAYS) * width, 0) / c.length,
        w: footprint(pick(c)),
      }));
      fit(rest, 0, width);
      restX = new Map(rest.map((b) => [b.c, b.x]));
      groupsWidth = width;
    }
    // Every other column keeps its members and moves aside.
    for (const c of groups) {
      if (c === group) continue;
      blocks.push({
        c,
        x: c.reduce((a, i) => a + at(points[i].days), 0) / c.length,
        w: footprint(pick(c)),
      });
    }
    blocks.sort((a, b) => a.x - b.x);
    const r = blocks.findIndex((b) => b.row);
    if (r >= 0) {
      const row = blocks[r];
      fit(blocks.slice(0, r), 0, row.x - row.w / 2 - gap);
      fit(blocks.slice(r + 1), row.x + row.w / 2 + gap, width);
    } else fit(blocks, 0, width);
    for (const b of blocks) {
      if (b.row) continue;
      drawn.push(b.c);
      const x = Math.min(Math.max(b.x, b.w / 2), width - b.w / 2);
      // A column shows up to three; more show two and a "+n".
      const crowded = b.c.length > 3;
      const visible = crowded ? b.c.slice(0, 2) : b.c;
      b.c.forEach((i) => {
        const slot = visible.indexOf(i);
        const top = slot === visible.length - 1;
        marks[i].toggleAttribute("data-hidden", slot < 0);
        marks[i].classList.remove("focus");
        // While another column is open, this one is inactive (faded) until
        // pointed at or focused, which opens it.
        if (group) marks[i].setAttribute("aria-disabled", "true");
        else marks[i].removeAttribute("aria-disabled");
        place(i, x, Math.max(slot, 0), {
          top,
          base: slot === 0,
          crowded: top && crowded,
          label: top ? short(pick(b.c)) : "",
        });
        if (top)
          marks[i].querySelector(".more")!.textContent = crowded
            ? `+${b.c.length - 2}`
            : "";
      });
    }
    [0, 7, 14, 21, DAYS].forEach(
      (d, i) => (ticks[i].style.transform = `translateX(${at(d)}px)`),
    );
    Object.assign(line.style, {
      left: `${at(0)}px`,
      width: `${at(DAYS) - at(0)}px`,
    });
    weeks.forEach((w, i) => {
      weekEls[i].style.transform =
        `translateX(${at(w.from)}px)${i ? " translateX(-50%)" : ""}`;
    });
  }

  function open(i: number | null) {
    if (i !== null && group?.includes(i)) return;
    if (i === null && group === null) return;
    if (i === null) group = null;
    else {
      group = groups.find((c) => c.includes(i))!;
      anchor = restX.get(group)!;
      settledAt = pointer;
    }
    render();
  }

  // The strip is divided into zones, one per column: any point belongs to
  // the nearest column, so there is no hunting for small icons. The open
  // column keeps a margin, so small moves can't flip it.
  const HOLD = 16;
  function underPointer() {
    if (!pointer) return -1;
    const x = pointer.x - lanes.getBoundingClientRect().left;
    let best = -1,
      bestD = Infinity;
    for (const c of drawn) {
      const xs = c.map((i) => now[i]);
      const half = c === group ? 19 : footprint(pick(c)) / 2;
      const lo = Math.min(...xs) - half,
        hi = Math.max(...xs) + half;
      let d = x < lo ? lo - x : x > hi ? x - hi : 0;
      if (c === group) d -= HOLD;
      if (d < bestD) ((bestD = d), (best = c[0]));
    }
    return best;
  }
  // Switch the moment the pointer is aiming: moving slowly, braking, or at
  // rest. A fast sweep across the strip changes nothing on the way.
  const AIMING = 0.45;
  let pointer: { x: number; y: number } | null = null,
    settledAt: { x: number; y: number } | null = null,
    lastMove = 0,
    lastSpeed = 0,
    restTimer = 0,
    leaveTimer = 0,
    held = false;
  const move = (e: PointerEvent) => {
    // Right after a switch, tiny moves don't count, so a layout settling
    // under a still pointer can't bounce between two columns.
    if (
      settledAt &&
      Math.hypot(e.clientX - settledAt.x, e.clientY - settledAt.y) < 8
    )
      return;
    settledAt = null;
    const t = performance.now();
    const speed = pointer
      ? Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) /
        Math.max(t - lastMove, 1)
      : 0;
    pointer = { x: e.clientX, y: e.clientY };
    lastMove = t;
    clearTimeout(leaveTimer);
    clearTimeout(restTimer);
    const act = () => {
      if (held) return;
      const i = underPointer();
      if (i >= 0) open(i);
    };
    const braking = speed < lastSpeed * 0.6;
    lastSpeed = speed;
    if (speed < AIMING || braking) act();
    else restTimer = window.setTimeout(act, 16);
  };
  const leave = () => {
    clearTimeout(restTimer);
    pointer = null;
    leaveTimer = window.setTimeout(() => !held && open(null), 150);
  };
  // Keyboard: focus moves are deliberate, so they switch straight away.
  const focusIn = (e: FocusEvent) => {
    const i = marks.indexOf((e.target as HTMLElement).closest(".pt")!);
    if (i >= 0 && !held) open(i);
  };
  const focusOut = (e: FocusEvent) => {
    if (!lanes.contains(e.relatedTarget as Node) && !pointer && !held)
      open(null);
  };
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerleave", leave);
  lanes.addEventListener("focusin", focusIn);
  lanes.addEventListener("focusout", focusOut);
  const observer = new ResizeObserver(() => {
    if (lanes.clientWidth !== width) {
      group = null;
      render();
    }
  });
  observer.observe(lanes);
  render();
  return {
    // While a payment's details are open, its column stays open.
    hold(value: boolean) {
      held = value;
      if (!value && !pointer && !lanes.contains(document.activeElement))
        open(null);
    },
    destroy() {
      clearTimeout(restTimer);
      clearTimeout(leaveTimer);
      observer.disconnect();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      lanes.removeEventListener("focusin", focusIn);
      lanes.removeEventListener("focusout", focusOut);
      root.removeAttribute("data-zoomed");
    },
  };
}
