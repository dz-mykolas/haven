import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { components } from "../lib/api.generated";

type Brand = components["schemas"]["BrandIcon"];

// Haven matches names against its embedded icon catalogue, so the browser
// never contacts a logo service. Unknown names resolve to null and keep the
// caller's fallback; the answer never changes, so it is fetched once.
async function brand(name: string, signal: AbortSignal) {
  const response = await fetch(`/api/icons?${new URLSearchParams({ name })}`, {
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Brand icon unavailable");
  return (await response.json()) as Brand;
}

// The brand a name matches, if any; shared with BrandIcon's cache.
export function useBrand(name: string) {
  const key = name.trim().toLowerCase();
  return useQuery({
    queryKey: ["brand-icon", key],
    queryFn: ({ signal }) => brand(key, signal),
    enabled: key.length > 0 && key.length <= 200,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export default function BrandIcon({
  name,
  size = 20,
  fallback,
}: {
  name: string;
  size?: number;
  fallback: ReactNode;
}) {
  const { data, isFetchedAfterMount } = useBrand(name);
  if (!data) return fallback;
  return (
    <svg
      className="brand-icon"
      data-arrived={isFetchedAfterMount || undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ "--brand": `#${data.hex}` } as CSSProperties}
      aria-hidden="true"
    >
      <path d={data.path} fill="currentColor" />
    </svg>
  );
}

// A bank account's logo, cached by Haven from the bank directory. The initial
// stays underneath until the image loads, and remains if there is none.
export function BankLogo({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  if (state === "none") return null;
  return (
    <img
      className="bank-logo"
      src={`/api/accounts/${encodeURIComponent(id)}/logo`}
      alt=""
      data-ready={state === "ready" || undefined}
      onLoad={() => setState("ready")}
      onError={() => setState("none")}
    />
  );
}
