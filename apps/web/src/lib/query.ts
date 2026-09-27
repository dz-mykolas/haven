import {
  QueryClient,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";

export function createQueryClient() {
  focusManager.setEventListener((setFocused) => {
    const update = () => {
      onlineManager.setOnline(navigator.onLine);
      setFocused(document.visibilityState === "visible" && navigator.onLine);
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
    };
  });
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: "always",
      },
    },
  });
}
