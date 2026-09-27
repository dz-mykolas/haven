import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { request, type Entry } from "../lib/api";
import type { components } from "../lib/api.generated";
export type ActivityPage = components["schemas"]["ActivityPage"];
export function useActivity(filters: Record<string, string>, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: ["activity", filters],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(filters);
      if (pageParam) params.set("cursor", pageParam);
      return request<ActivityPage>(
        `/entries?${params}`,
        undefined,
        "GET",
        signal,
      );
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled,
    refetchInterval: 15000,
  });
  const entries = useMemo(() => {
    const unique = new Map<string, Entry>();
    for (const page of query.data?.pages ?? [])
      for (const entry of page.items)
        if (!unique.has(entry.id)) unique.set(entry.id, entry);
    return [...unique.values()];
  }, [query.data]);
  return { ...query, entries, total: query.data?.pages[0]?.total ?? 0 };
}
