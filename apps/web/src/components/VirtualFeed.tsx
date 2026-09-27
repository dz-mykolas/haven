import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import { LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";

export type FeedRow = { key: string; estimate: number; content: ReactNode };

// Use the document scrollbar, and keep a focused row mounted for keyboard/menu
// interactions. Row heights are measured because tags and notes can wrap.
export default function VirtualFeed({
  rows,
  hasNextPage,
  fetching,
  nextError,
  loadMore,
  resetKey,
  label,
}: {
  rows: FeedRow[];
  hasNextPage: boolean;
  fetching: boolean;
  nextError?: string;
  loadMore: () => Promise<unknown>;
  resetKey: string;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [focusedKey, setFocusedKey] = useState("");
  const previousKey = useRef(resetKey);
  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current) return;
      const top = root.current.getBoundingClientRect().top + window.scrollY;
      setMargin(top);
      if (previousKey.current !== resetKey) {
        previousKey.current = resetKey;
        if (window.scrollY > top) window.scrollTo({ top, behavior: "instant" });
      }
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    if (root.current?.parentElement)
      observer.observe(root.current.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [resetKey]);
  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? "load-more",
    [rows],
  );
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indices = defaultRangeExtractor(range);
      const focused = rows.findIndex((row) => row.key === focusedKey);
      if (focused >= 0 && !indices.includes(focused)) indices.push(focused);
      return indices.sort((a, b) => a - b);
    },
    [rows, focusedKey],
  );
  const virtualizer = useWindowVirtualizer({
    count: rows.length + (hasNextPage ? 1 : 0),
    estimateSize: (index) => rows[index]?.estimate ?? 56,
    getItemKey,
    scrollMargin: margin,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor,
  });
  const previousRows = useRef<{ scope: string; keys: string[] }>({
    scope: resetKey,
    keys: [],
  });
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const captureAnchor = useCallback(() => {
    if (window.scrollY <= margin) {
      anchor.current = null;
      return;
    }
    const visible = virtualizer
      .getVirtualItems()
      .find((item) => item.end > window.scrollY && item.index < rows.length);
    if (visible)
      anchor.current = {
        key: rows[visible.index].key,
        offset: window.scrollY - visible.start,
      };
  }, [virtualizer, rows, margin]);
  useLayoutEffect(() => {
    const keys = rows.map((row) => row.key);
    const previous = previousRows.current;
    const changed =
      previous.keys.length !== keys.length ||
      previous.keys.some((key, index) => key !== keys[index]);
    if (previous.scope !== resetKey) anchor.current = null;
    else if (changed && anchor.current && previous.keys.length) {
      const oldIndex = previous.keys.indexOf(anchor.current.key);
      const nextKey = keys.includes(anchor.current.key)
        ? anchor.current.key
        : previous.keys.slice(oldIndex + 1).find((key) => keys.includes(key));
      const index = nextKey ? keys.indexOf(nextKey) : -1;
      const position =
        index >= 0 ? virtualizer.measurementsCache[index]?.start : undefined;
      if (position !== undefined)
        window.scrollTo({
          top: position + anchor.current.offset,
          behavior: "instant",
        });
    }
    previousRows.current = { scope: resetKey, keys };
    captureAnchor();
  }, [rows, resetKey, virtualizer, captureAnchor]);
  useEffect(() => {
    window.addEventListener("scroll", captureAnchor, { passive: true });
    return () => window.removeEventListener("scroll", captureAnchor);
  }, [captureAnchor]);
  const virtualItems = virtualizer.getVirtualItems();
  const lastVisible = virtualizer.range?.endIndex ?? -1;
  useEffect(() => {
    if (
      hasNextPage &&
      !fetching &&
      !nextError &&
      lastVisible >= rows.length - 6
    )
      void loadMore();
  }, [lastVisible, rows.length, hasNextPage, fetching, nextError, loadMore]);
  return (
    <div
      ref={root}
      className="virtual-feed"
      role="group"
      aria-label={label}
      data-feed={label}
    >
      <div
        className="virtual-feed-canvas"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            data-feed-key={rows[item.index]?.key}
            ref={virtualizer.measureElement}
            className="virtual-feed-row"
            style={{ transform: `translateY(${item.start - margin}px)` }}
            onFocusCapture={() => {
              if (rows[item.index]) setFocusedKey(rows[item.index].key);
            }}
          >
            {item.index < rows.length ? (
              rows[item.index].content
            ) : (
              <div className="feed-load-state">
                {nextError ? (
                  <>
                    <span role="alert">{nextError}</span>
                    <Button
                      variant="ghost"
                      disabled={fetching}
                      onClick={() => void loadMore()}
                    >
                      Retry loading
                    </Button>
                  </>
                ) : (
                  <span role="status">
                    <LoaderCircle
                      size={18}
                      className="loading"
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      Loading more {label.toLowerCase()}…
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {!hasNextPage && rows.length > 0 && (
        <span className="sr-only" role="status">
          End of {label.toLowerCase()}.
        </span>
      )}
    </div>
  );
}
