import { useEffect } from "react";

// One overlay scrollbar for the whole app. Native scrollbars are hidden
// (they take room and bring a track), so this draws a thumb over the edge of
// whatever is being scrolled: it takes no space and has no track. With a
// mouse or trackpad it stays in view (on the page, or whatever was last
// scrolled or pointed at near its edge); on touch screens it appears while
// scrolling and fades when idle. It can be dragged.
export default function Scrollbars() {
  useEffect(() => mount(), []);
  return null;
}

type Axis = "y" | "x";
const EDGE = 16; // how near the edge the pointer brings the bar up
const IDLE = 900;

function mount() {
  const root = document.scrollingElement as HTMLElement;
  const desktop = matchMedia("(hover: hover) and (pointer: fine)");
  const thumbs = {
    y: make("y"),
    x: make("x"),
  };
  let target: HTMLElement | null = null,
    frame = 0,
    idle = 0,
    dragging: {
      axis: Axis;
      start: number;
      scroll: number;
      ratio: number;
    } | null = null,
    over = false;

  function make(axis: Axis) {
    const el = document.createElement("div");
    el.className = "scroll-thumb";
    el.dataset.axis = axis;
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("pointerdown", (e) => grab(e, axis));
    el.addEventListener("pointerenter", () => ((over = true), wake()));
    el.addEventListener("pointerleave", () => ((over = false), wake()));
    return el;
  }

  const scrollable = (el: HTMLElement, axis: Axis) => {
    const size =
      axis === "y"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    if (size < 2) return false;
    if (el === root) return true;
    const overflow =
      getComputedStyle(el)[axis === "y" ? "overflowY" : "overflowX"];
    return overflow === "auto" || overflow === "scroll";
  };
  // The nearest element that scrolls, from `el` outwards.
  function scroller(el: Element | null): HTMLElement | null {
    for (let node = el; node && node !== root; node = node.parentElement)
      if (
        node instanceof HTMLElement &&
        (scrollable(node, "y") || scrollable(node, "x"))
      )
        return node;
    return scrollable(root, "y") || scrollable(root, "x") ? root : null;
  }
  // A thumb for a dialog's content lives inside that dialog: modal <dialog>s
  // sit in the top layer, and other dialogs treat a press outside them as a
  // dismissal.
  function host(el: HTMLElement) {
    return (
      el.closest<HTMLElement>('dialog[open], [role="dialog"]') ?? document.body
    );
  }
  // Where a fixed-position thumb's (0, 0) lands inside its host: the
  // viewport's corner, or the host's own box if it contains fixed children
  // (through a transform, translate, filter and so on). Measured directly.
  function origin(thumb: HTMLElement) {
    thumb.style.transform = "none";
    const box = thumb.getBoundingClientRect();
    return { x: box.left, y: box.top };
  }

  function layout() {
    frame = 0;
    // Whatever it was on is gone or no longer scrolls: back to the page.
    if (
      target !== root &&
      (!target?.isConnected ||
        !(scrollable(target, "y") || scrollable(target, "x")))
    )
      target = root;
    for (const axis of ["y", "x"] as Axis[]) {
      const thumb = thumbs[axis];
      if (!target || !target.isConnected || !scrollable(target, axis)) {
        thumb.hidden = true;
        continue;
      }
      const h = host(target);
      if (thumb.parentElement !== h) h.append(thumb);
      thumb.hidden = false;
      const box =
        target === root
          ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
          : target.getBoundingClientRect();
      const o = origin(thumb);
      const inset = 3;
      if (axis === "y") {
        const view = target.clientHeight,
          full = target.scrollHeight;
        const track = view - inset * 2;
        const size = Math.max(28, (track * view) / full);
        const at = (target.scrollTop / (full - view) || 0) * (track - size);
        const top =
          (target === root ? 0 : box.top + target.clientTop) + inset + at;
        const right =
          target === root
            ? innerWidth
            : box.left + target.clientLeft + target.clientWidth;
        thumb.style.height = `${size}px`;
        thumb.style.transform = `translate(${right - inset - o.x}px, ${top - o.y}px) translateX(-100%)`;
        thumb.dataset.ratio = String((full - view) / (track - size));
      } else {
        const view = target.clientWidth,
          full = target.scrollWidth;
        const track = view - inset * 2 - (scrollable(target, "y") ? 12 : 0);
        const size = Math.max(28, (track * view) / full);
        const at = (target.scrollLeft / (full - view) || 0) * (track - size);
        const left =
          (target === root ? 0 : box.left + target.clientLeft) + inset + at;
        const bottom =
          target === root
            ? innerHeight
            : box.top + target.clientTop + target.clientHeight;
        thumb.style.width = `${size}px`;
        thumb.style.transform = `translate(${left - o.x}px, ${bottom - inset - o.y}px) translateY(-100%)`;
        thumb.dataset.ratio = String((full - view) / (track - size));
      }
    }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(layout);
  };
  // Show the bar, and let it fade again once nothing is happening.
  function wake() {
    thumbs.y.dataset.visible = thumbs.x.dataset.visible = "";
    clearTimeout(idle);
    if (desktop.matches) return;
    idle = window.setTimeout(() => {
      if (dragging || over) return;
      delete thumbs.y.dataset.visible;
      delete thumbs.x.dataset.visible;
    }, IDLE);
  }
  function show(el: HTMLElement | null) {
    if (!el) return;
    if (el !== target) target = el;
    schedule();
    wake();
  }

  function grab(e: PointerEvent, axis: Axis) {
    if (!target || e.button !== 0) return;
    e.preventDefault();
    const thumb = thumbs[axis];
    thumb.setPointerCapture(e.pointerId);
    thumb.dataset.dragging = "";
    dragging = {
      axis,
      start: axis === "y" ? e.clientY : e.clientX,
      scroll: axis === "y" ? target.scrollTop : target.scrollLeft,
      ratio: Number(thumb.dataset.ratio) || 1,
    };
    const move = (m: PointerEvent) => {
      if (!dragging || !target) return;
      const delta = (axis === "y" ? m.clientY : m.clientX) - dragging.start;
      if (axis === "y")
        target.scrollTop = dragging.scroll + delta * dragging.ratio;
      else target.scrollLeft = dragging.scroll + delta * dragging.ratio;
    };
    const end = () => {
      dragging = null;
      delete thumb.dataset.dragging;
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
      wake();
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  }

  const onScroll = (e: Event) => {
    const el = e.target === document ? root : (e.target as HTMLElement | null);
    if (
      el instanceof HTMLElement &&
      (scrollable(el, "y") || scrollable(el, "x"))
    )
      show(el);
  };
  const onPointer = (e: PointerEvent) => {
    if (dragging || e.pointerType === "touch") return;
    const el = scroller(e.target as Element);
    if (!el) return;
    const box =
      el === root
        ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
        : el.getBoundingClientRect();
    const nearY = scrollable(el, "y") && box.right - e.clientX < EDGE;
    const nearX = scrollable(el, "x") && box.bottom - e.clientY < EDGE;
    if (nearY || nearX) show(el);
  };
  // The page growing or shrinking (content added or removed) resizes the
  // root, which is what makes it start or stop scrolling.
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  const changed = () => (desktop.matches ? wake() : schedule());
  desktop.addEventListener("change", changed);

  document.body.append(thumbs.y, thumbs.x);
  thumbs.y.hidden = thumbs.x.hidden = true;
  target = root;
  schedule();
  if (desktop.matches) wake();
  document.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  document.addEventListener("pointermove", onPointer, { passive: true });
  addEventListener("resize", schedule);
  return () => {
    clearTimeout(idle);
    cancelAnimationFrame(frame);
    observer.disconnect();
    desktop.removeEventListener("change", changed);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("pointermove", onPointer);
    removeEventListener("resize", schedule);
    thumbs.y.remove();
    thumbs.x.remove();
  };
}
