import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

// Move only the selection surface; labels and keyboard focus stay on their buttons.
export function SelectionGroup({
  as = "div",
  label,
  value,
  className = "",
  children,
}: {
  as?: "div" | "nav";
  label: string;
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null),
    indicator = useRef<HTMLSpanElement>(null);
  const initialized = useRef(false),
    animation = useRef<Animation | null>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const group = root.current!,
      pill = indicator.current!;
    const position = (animate: boolean) => {
      const selected = group.querySelector<HTMLElement>(
        '[aria-current="page"], [aria-pressed="true"]',
      );
      if (!selected) return;
      // Read the current animated rectangle so rapid changes continue from what is visible.
      const previous = pill.getBoundingClientRect();
      const container = group.getBoundingClientRect(),
        next = selected.getBoundingClientRect();
      if (!next.width || !container.width) return;
      const scaleX = group.offsetWidth / container.width,
        scaleY = group.offsetHeight / container.height;
      animation.current?.cancel();
      Object.assign(pill.style, {
        left: `${selected.offsetLeft}px`,
        top: `${selected.offsetTop}px`,
        width: `${selected.offsetWidth}px`,
        height: `${selected.offsetHeight}px`,
        opacity: "1",
      });
      if (
        animate &&
        initialized.current &&
        !reduced &&
        previous.width &&
        next.width &&
        typeof pill.animate === "function"
      ) {
        animation.current = pill.animate(
          [
            {
              transform: `translate(${(previous.left - next.left) * scaleX}px, ${(previous.top - next.top) * scaleY}px) scale(${previous.width / next.width}, ${previous.height / next.height})`,
            },
            { transform: "none" },
          ],
          { duration: 320, easing: ease },
        );
      }
      initialized.current = true;
    };
    position(true);
    // Resizing switches between the desktop rail and mobile bar without a flying highlight.
    const observer = new ResizeObserver(() => {
      const selected = group.querySelector<HTMLElement>(
        '[aria-current="page"], [aria-pressed="true"]',
      );
      if (!selected) return;
      if (
        !initialized.current ||
        Math.abs(parseFloat(pill.style.left) - selected.offsetLeft) > 0.5 ||
        Math.abs(parseFloat(pill.style.top) - selected.offsetTop) > 0.5 ||
        Math.abs(parseFloat(pill.style.width) - selected.offsetWidth) > 0.5 ||
        Math.abs(parseFloat(pill.style.height) - selected.offsetHeight) > 0.5
      )
        position(false);
    });
    observer.observe(group);
    for (const child of group.querySelectorAll("button"))
      observer.observe(child);
    return () => observer.disconnect();
  }, [value, reduced]);
  useEffect(() => () => animation.current?.cancel(), []);
  return createElement(
    as,
    {
      ref: root,
      className: `selection-group ${className}`,
      "aria-label": label,
      role: as === "div" ? "group" : undefined,
      "data-selection": value,
    },
    <span ref={indicator} className="selection-indicator" aria-hidden="true" />,
    children,
  );
}

// Animate large surfaces on intentional view changes, never on data refresh or keystrokes.
export function MotionView({
  value,
  order = 0,
  compact = false,
  children,
}: {
  value: string;
  order?: number;
  compact?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null),
    previous = useRef(order);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const direction = order < previous.current ? -1 : 1;
    previous.current = order;
    if (reduced) return;
    const surfaces = compact
      ? [root.current!]
      : [...root.current!.querySelectorAll<HTMLElement>("[data-motion-block]")];
    const animations = surfaces.map((surface, index) =>
      surface.animate?.(
        [
          {
            opacity: 0,
            transform: compact
              ? "translateY(6px)"
              : `translateX(${direction * 12}px) translateY(3px)`,
          },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: compact ? 200 : 360,
          delay: compact ? 0 : Math.min(index, 3) * 24,
          easing: ease,
          fill: "backwards",
        },
      ),
    );
    return () => animations.forEach((animation) => animation?.cancel());
  }, [value, order, compact, reduced]);
  return (
    <div ref={root} className={compact ? "motion-list" : "motion-view"}>
      {children}
    </div>
  );
}

// Animate the task surfaces, keeping text and controls together. Stable keys let
// remaining rows settle into place after a completion or a changed due date.
export function AnimatedTaskList({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { top: number; left: number }>());
  const previousView = useRef(value);
  const animations = useRef<Animation[]>([]);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    animations.current = animations.current.filter((animation) => {
      if (reduced || animation.playState !== "running") {
        animation.cancel();
        return false;
      }
      return true;
    });
    const container = root.current!;
    const next = new Map<string, { top: number; left: number }>();
    const sameView = previousView.current === value;
    container
      .querySelectorAll<HTMLElement>("[data-task-key]")
      .forEach((row, index) => {
        const key = row.dataset.taskKey!;
        const position = {
          top: row.offsetTop,
          left: row.offsetLeft,
        };
        next.set(key, position);
        const old = sameView ? previous.current.get(key) : undefined;
        if (reduced) return;
        if (!old) {
          row.getAnimations().forEach((animation) => animation.cancel());
          animations.current.push(
            row.animate(
              [
                { opacity: 0, transform: "translateY(10px) scale(0.99)" },
                { opacity: 1, transform: "none" },
              ],
              {
                duration: 300,
                delay: Math.min(index, 5) * 24,
                easing: ease,
                fill: "backwards",
              },
            ),
          );
        } else if (
          Math.abs(old.top - position.top) > 1 ||
          Math.abs(old.left - position.left) > 1
        ) {
          row.getAnimations().forEach((animation) => animation.cancel());
          animations.current.push(
            row.animate(
              [
                {
                  transform: `translate(${old.left - position.left}px, ${old.top - position.top}px)`,
                },
                { transform: "none" },
              ],
              { duration: 320, easing: ease },
            ),
          );
        }
      });
    previous.current = next;
    previousView.current = value;
  }, [children, value, reduced]);
  useEffect(
    () => () => animations.current.forEach((animation) => animation.cancel()),
    [],
  );
  return (
    <div className="animated-task-list" ref={root}>
      {children}
    </div>
  );
}
