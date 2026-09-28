import {
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
  // Which neighbour is mounted beside the page: 1 is to the right.
  const [side, setSide] = useState<-1 | 0 | 1>(0);
  const neighbour = side ? at(side).id : null;
  const pager = useRef<HTMLDivElement>(null),
    bar = useRef<HTMLElement>(null);
  const slides = useRef(new Map<string, HTMLDivElement>());
  // -1…1; positive moves towards the right neighbour.
  const progress = useRef(0);
  const current = useRef({ page, side });
  current.current = { page, side };
  const settling = useRef<number | null>(null),
    queued = useRef<-1 | 1 | null>(null),
    top = useRef(0);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    active: boolean;
    samples: { x: number; t: number }[];
  } | null>(null);
  const suppressClick = useRef(false);

  const distance = () => (pager.current?.offsetWidth ?? innerWidth) + 24;
  function apply(p: number) {
    progress.current = p;
    const { page, side } = current.current;
    const width = distance();
    for (const [id, slide] of slides.current) {
      const offset = id === page ? 0 : side;
      const d = offset - p;
      const still = p === 0 && offset === 0;
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
        slot.style.setProperty(
          "--shown",
          // Items beyond the neighbours fade out quickly, so the looping
          // copy leaving one end and arriving at the other never shows twice.
          String(Math.max(0, Math.min(1, (1.6 - Math.abs(d)) / 0.6))),
        );
      });
  }
  function settle(target: -1 | 0 | 1) {
    const from = progress.current,
      start = performance.now();
    const duration = reduced ? 0 : Math.max(180, 420 * Math.abs(target - from));
    const frame = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      apply(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) {
        settling.current = requestAnimationFrame(frame);
        return;
      }
      settling.current = null;
      setSide(0);
      if (target) onChange(at(target).id);
    };
    settling.current = requestAnimationFrame(frame);
  }
  function open(next: -1 | 1) {
    top.current = window.scrollY;
    setSide(next);
  }
  function go(offset: -1 | 1) {
    if (settling.current !== null || gesture.current?.active) return;
    if (current.current.side === offset) return settle(offset);
    queued.current = offset;
    open(offset);
  }
  useImperativeHandle(control, () => ({
    go(id) {
      if (!phone || id === page) return false;
      const offset = at(1).id === id ? 1 : at(-1).id === id ? -1 : 0;
      if (!offset) return false;
      go(offset);
      return true;
    },
  }));
  // The neighbour became the page: it is already in place, at the top.
  useLayoutEffect(() => {
    progress.current = 0;
    if (phone) window.scrollTo(0, 0);
  }, [page]);
  // Newly rendered slides and bar items start where the motion already is.
  useLayoutEffect(() => apply(progress.current));
  // A tap starts moving once its neighbour is in place.
  useLayoutEffect(() => {
    if (side && queued.current === side) {
      queued.current = null;
      settle(side);
    }
  }, [side]);
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
      top.current = window.scrollY;
    }
    state.samples = [
      ...state.samples.filter((sample) => event.timeStamp - sample.t < 90),
      { x: event.clientX, t: event.timeStamp },
    ];
    const p = Math.max(
      -1,
      Math.min(1, -(event.clientX - state.x) / distance()),
    );
    const want = p > 0 ? 1 : p < 0 ? -1 : current.current.side;
    if (want !== current.current.side) {
      current.current.side = want;
      setSide(want);
    }
    apply(p);
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
      side = current.current.side;
    const flung = Math.abs(speed) > 0.0009 && Math.sign(speed) === side;
    const commit =
      event.type === "pointerup" && side !== 0 && (Math.abs(p) > 0.3 || flung);
    settle(commit ? side : 0);
  }

  const shown = neighbour
    ? items.filter((item) => item.id === page || item.id === neighbour)
    : items.filter((item) => item.id === page);
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
            style={id === page ? undefined : { top: top.current }}
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
