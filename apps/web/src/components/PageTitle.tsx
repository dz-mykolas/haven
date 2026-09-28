import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ease, useReducedMotion } from "./Motion";

// The title every module shows in the same place. Switching modules changes it
// in place: the icon swaps inside its circle and the word rolls like an
// odometer, up when moving down the sidebar and down when moving back up.
type Shown = {
  title: string;
  icon: ReactNode;
  order: number;
  background: string;
  color: string;
};
let shown: Shown | null = null;

export default function PageTitle({
  icon,
  title,
  order,
}: {
  icon: ReactNode;
  title: string;
  // The module's place in the sidebar.
  order: number;
}) {
  const [from] = useState(() =>
    shown && shown.title !== title ? shown : null,
  );
  const [settled, setSettled] = useState(false);
  const mark = useRef<HTMLSpanElement>(null),
    glyph = useRef<HTMLSpanElement>(null),
    oldGlyph = useRef<HTMLSpanElement>(null),
    word = useRef<HTMLSpanElement>(null),
    oldWord = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const rolling = !!from && !reduced && !settled;
  // Remembered after layout effects, once the page's own tint is applied.
  useEffect(() => {
    const style = getComputedStyle(mark.current!);
    shown = {
      title,
      icon,
      order,
      background: style.backgroundColor,
      color: style.color,
    };
  });
  useLayoutEffect(() => {
    if (!rolling || !from) return;
    const up = order > from.order ? 1 : -1;
    const timing = { duration: 460, easing: ease, fill: "both" as const };
    const animations = [
      word.current!.animate(
        [
          { opacity: 0, transform: `translateY(${up * 75}%)` },
          { opacity: 1, transform: "none" },
        ],
        timing,
      ),
      oldWord.current!.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: `translateY(${-up * 75}%)` },
        ],
        timing,
      ),
      glyph.current!.animate(
        [
          { opacity: 0, transform: "scale(0.4)" },
          { opacity: 1, transform: "none" },
        ],
        { ...timing, delay: 60 },
      ),
      oldGlyph.current!.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(0.4)" },
        ],
        { ...timing, duration: 240 },
      ),
      // Ends on whatever tint the new module sets.
      mark.current!.animate(
        [{ backgroundColor: from.background, color: from.color }, {}],
        { duration: 460, easing: ease },
      ),
    ];
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => setSettled(true),
      () => {},
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [rolling]);
  return (
    <>
      <span className="title-mark" ref={mark} aria-hidden="true">
        <span className="title-glyph" ref={glyph}>
          {icon}
        </span>
        {rolling && (
          <span className="title-glyph" ref={oldGlyph}>
            {from.icon}
          </span>
        )}
      </span>
      <h1 className="page-title-word">
        <span ref={word}>{title}</span>
        {rolling && (
          <span className="title-old" ref={oldWord} aria-hidden="true">
            {from.title}
          </span>
        )}
      </h1>
    </>
  );
}
