import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { usePhone, useReducedMotion } from "./Motion";

export type ModuleItem = {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
  countLabel?: string;
};
export type PagerControl = { go: (id: string) => boolean };

// Swipes that start this close to the screen edge belong to the phone's back gesture.
const edge = 20;
// Distance between items in the bottom carousel.
const spacing = 84;

// On phones the modules sit side by side in a loop: a sideways swipe drags the
// current module's content away and the neighbour's in, and the bottom bar rolls
// with it. The page background stays put and only blends its colour. A swipe
// that starts on something that moves sideways itself (a task row) is left to it.
export default function ModulePager({
  page,
  items,
  onChange,
  render,
  control,
}: {
  page: string;
  items: ModuleItem[];
  onChange: (id: string) => void;
  render: (id: string) => ReactNode;
  control: Ref<PagerControl>;
}) {
  const phone = usePhone(),
    reduced = useReducedMotion();
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === page),
  );
  const at = (offset: number) =>
    items[(((index + offset) % items.length) + items.length) % items.length];
  const offsetOf = (id: string) =>
    id === page ? 0 : id === at(1).id ? 1 : id === at(-1).id ? -1 : null;
  // Neighbours are built once the phone is idle, so a swipe only moves them.
  const [preloaded, setPreloaded] = useState(false);
  const pager = useRef<HTMLDivElement>(null),
    bar = useRef<HTMLElement>(null);
  const slides = useRef(new Map<string, HTMLDivElement>());
  // -1…1; positive moves towards the right neighbour.
  const progress = useRef(0);
  const layout = useRef({ page, offsetOf });
  layout.current = { page, offsetOf };
  const settling = useRef<number | null>(null),
    queued = useRef<-1 | 1 | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    active: boolean;
    samples: { x: number; t: number }[];
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!phone) return setPreloaded(false);
    if (preloaded) return;
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => setPreloaded(true), { timeout: 1500 })
      : window.setTimeout(() => setPreloaded(true), 400);
    return () =>
      window.cancelIdleCallback
        ? window.cancelIdleCallback(idle)
        : clearTimeout(idle);
  }, [phone, preloaded]);

  const distance = () => (pager.current?.offsetWidth ?? innerWidth) + 24;
  // Neighbours lie level with where the page's top sits once it is scrolled up.
  function place() {
    const box = pager.current?.getBoundingClientRect();
    if (!box) return;
    for (const [id, slide] of slides.current)
      Object.assign(
        slide.style,
        id === layout.current.page
          ? { top: "", left: "", width: "" }
          : {
              top: `${box.top + window.scrollY}px`,
              left: `${box.left}px`,
              width: `${box.width}px`,
            },
      );
  }
  function wake(moving: boolean) {
    if (moving) pager.current?.setAttribute("data-moving", "");
    else pager.current?.removeAttribute("data-moving");
    for (const slide of slides.current.values())
      if (!moving) delete slide.dataset.awake;
  }
  function apply(p: number) {
    progress.current = p;
    const width = distance();
    for (const [id, slide] of slides.current) {
      const offset = layout.current.offsetOf(id) ?? 2;
      const d = offset - p;
      const still = p === 0 && offset === 0;
      // Only the neighbour coming in renders; the other stays asleep.
      if (offset !== 0 && Math.sign(p) === offset) slide.dataset.awake = "";
      slide.style.transform = still ? "" : `translateX(${d * width}px)`;
      slide.style.opacity = still
        ? ""
        : String(1 - Math.min(1, Math.abs(d)) * 0.35);
    }
    bar.current
      ?.querySelectorAll<HTMLElement>("[data-slot]")
      .forEach((slot) => {
        const d = Number(slot.dataset.slot) - p,
          near = Math.min(1, Math.abs(d));
        slot.style.transform = `translateX(${d * spacing}px) scale(${1 - 0.14 * near})`;
        slot.style.setProperty("--near", String(1 - near));
        // Items beyond the neighbours fade out quickly, so the looping
        // copy leaving one end and arriving at the other never shows twice.
        slot.style.setProperty(
          "--shown",
          String(Math.max(0, Math.min(1, (1.6 - Math.abs(d)) / 0.6))),
        );
      });
  }
  function settle(target: -1 | 0 | 1) {
    const from = progress.current,
      start = performance.now();
    const duration = reduced ? 0 : Math.max(180, 420 * Math.abs(target - from));
    wake(true);
    const frame = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      apply(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) {
        settling.current = requestAnimationFrame(frame);
        return;
      }
      settling.current = null;
      if (target) onChange(at(target).id);
      else wake(false);
    };
    settling.current = requestAnimationFrame(frame);
  }
  function go(offset: -1 | 1) {
    if (settling.current !== null || gesture.current?.active) return;
    if (preloaded) {
      place();
      return settle(offset);
    }
    queued.current = offset;
    setPreloaded(true);
  }
  useImperativeHandle(control, () => ({
    go(id) {
      if (!phone || id === page) return false;
      const offset = offsetOf(id);
      if (!offset) return false;
      go(offset);
      return true;
    },
  }));
  // The neighbour became the page: it is already in place, at the top.
  useLayoutEffect(() => {
    progress.current = 0;
    wake(false);
    if (phone) window.scrollTo(0, 0);
  }, [page]);
  // Newly rendered slides and bar items start where the motion already is.
  useLayoutEffect(() => {
    place();
    apply(progress.current);
  });
  // A tap before the neighbours were built starts moving once they are.
  useLayoutEffect(() => {
    if (preloaded && queued.current) {
      const offset = queued.current;
      queued.current = null;
      settle(offset);
    }
  }, [preloaded]);
  useLayoutEffect(
    () => () => {
      if (settling.current !== null) cancelAnimationFrame(settling.current);
    },
    [],
  );

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      !phone ||
      event.pointerType === "mouse" ||
      !event.isPrimary ||
      settling.current !== null ||
      event.clientX < edge ||
      event.clientX > innerWidth - edge ||
      (event.target as Element).closest(
        "input, textarea, select, [contenteditable], [data-no-swipe]",
      )
    )
      return;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      samples: [],
    };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x,
      dy = event.clientY - state.y;
    if (!state.active) {
      // Scrolling, or a row taking its own drag.
      if (
        (event.target as Element).closest("[data-dragging]") ||
        (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx))
      ) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      state.active = true;
      state.x = event.clientX;
      pager.current!.setPointerCapture(event.pointerId);
      if (!preloaded) setPreloaded(true);
      place();
      wake(true);
    }
    state.samples = [
      ...state.samples.filter((sample) => event.timeStamp - sample.t < 90),
      { x: event.clientX, t: event.timeStamp },
    ];
    apply(Math.max(-1, Math.min(1, -(event.clientX - state.x) / distance())));
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    gesture.current = null;
    if (!state.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const first = state.samples[0],
      last = state.samples.at(-1);
    // Finger speed in progress units per millisecond, towards the neighbour.
    const speed =
      first && last && last.t > first.t
        ? -(last.x - first.x) / (last.t - first.t) / distance()
        : 0;
    const p = progress.current,
      side = Math.sign(p) as -1 | 0 | 1;
    const flung = Math.abs(speed) > 0.0009 && Math.sign(speed) === side;
    const commit =
      event.type === "pointerup" && side !== 0 && (Math.abs(p) > 0.3 || flung);
    settle(commit ? side : 0);
  }

  const shown = items.filter(
    (item) =>
      item.id === page || (phone && preloaded && offsetOf(item.id) !== null),
  );
  return (
    <>
      <div
        ref={pager}
        className="module-pager"
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
        {shown.map(({ id }) => (
          <div
            key={id}
            ref={(element) => {
              if (element) slides.current.set(id, element);
              else slides.current.delete(id);
            }}
            className="module-slide module-scope"
            data-module={phone ? id : undefined}
            data-neighbour={id === page ? undefined : ""}
            inert={id !== page}
            aria-hidden={id === page ? undefined : true}
          >
            {render(id)}
          </div>
        ))}
      </div>
      {phone && (
        <nav ref={bar} className="module-bar" aria-label="Modules">
          {[-2, -1, 0, 1, 2].map((slot) => {
            const item = at(slot);
            const hidden = Math.abs(slot) > 1;
            return (
              <button
                key={slot}
                type="button"
                data-slot={slot}
                data-module={item.id}
                className="module-bar-item module-scope"
                aria-label={
                  item.count && item.countLabel
                    ? `${item.label}, ${item.countLabel}`
                    : item.label
                }
                aria-current={slot === 0 ? "page" : undefined}
                // Copies that only exist to roll in from beyond the ends.
                inert={hidden}
                aria-hidden={hidden || undefined}
                onClick={() => {
                  if (slot === 0)
                    window.scrollTo({
                      top: 0,
                      behavior: reduced ? "auto" : "smooth",
                    });
                  else if (!hidden) go(slot as -1 | 1);
                }}
              >
                <span className="module-bar-icon">
                  {item.icon}
                  {!!item.count && (
                    <span className="module-bar-count" aria-hidden="true">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  )}
                </span>
                <span className="module-bar-label" aria-hidden="true">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
