import { useEffect } from "react";

// One request at a time; resume promptly after returning or reconnecting.
export function useAutoRefresh(
  refresh: (signal: AbortSignal, initial: boolean) => Promise<unknown>,
  interval: number,
) {
  useEffect(() => {
    let active = true;
    let running = false;
    let pending = false;
    let initial = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const available = () =>
      document.visibilityState === "visible" && navigator.onLine;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (active && available()) timer = setTimeout(run, delay);
    };
    const run = async () => {
      if (!active || !available()) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      pending = false;
      controller = new AbortController();
      try {
        const first = initial;
        initial = false;
        await refresh(controller.signal, first);
      } finally {
        running = false;
        schedule(pending ? 0 : interval);
      }
    };
    const resume = () => schedule(150);
    const visibility = () => {
      clearTimeout(timer);
      if (available()) resume();
    };
    void run();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh, interval]);
}
