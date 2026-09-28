import { useBackdropDismiss } from "./useBackdropDismiss";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CheckCheck,
  Download,
  Leaf,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { SelectionGroup } from "./Motion";

type Destination = "assistant" | "money" | "tasks";
type Theme = "system" | "light" | "dark";

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query),
      update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useNavigation() {
  const mobile = useMedia("(max-width: 767px)"),
    wide = useMedia("(min-width: 1200px)");
  const [preference, setPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem("haven-sidebar-collapsed");
      if (saved !== null) return saved === "true";
    } catch {}
    return null;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = preference ?? !wide;
  useEffect(() => {
    if (!mobile) setMobileOpen(false);
  }, [mobile]);
  function toggleCollapsed() {
    const next = !collapsed;
    setPreference(next);
    try {
      localStorage.setItem("haven-sidebar-collapsed", String(next));
    } catch {}
  }
  return { mobile, collapsed, mobileOpen, setMobileOpen, toggleCollapsed };
}

type Props = {
  page: Destination;
  theme: Theme;
  dueCount: number;
  reviewCount: number;
  onNavigate: (page: Destination) => void;
  onTheme: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  navigation: ReturnType<typeof useNavigation>;
};

function SidebarContent({
  page,
  theme,
  dueCount,
  reviewCount,
  onNavigate,
  onTheme,
  onExport,
  exportDisabled,
  navigation,
  drawer = false,
}: Props & { drawer?: boolean }) {
  const collapsed = !drawer && navigation.collapsed;
  const go = (next: Destination) => {
    onNavigate(next);
    navigation.setMobileOpen(false);
  };
  return (
    <div className="sidebar-content" data-collapsed={collapsed}>
      <div className="sidebar-header">
        <a
          className="brand"
          href="#assistant"
          aria-label="Haven home"
          onClick={(event) => {
            event.preventDefault();
            go("assistant");
          }}
        >
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          <span className="sidebar-label brand-name">
            haven<span className="brand-dot">.</span>
          </span>
        </a>
        {drawer ? (
          <button
            className="icon-button sidebar-toggle"
            aria-label="Close menu"
            title="Close menu"
            data-drawer-close
            onClick={() => navigation.setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        ) : (
          <button
            className="icon-button sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="desktop-navigation"
            onClick={navigation.toggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
        )}
      </div>
      {/* On phones the bottom bar moves between modules; the menu keeps the rest. */}
      {!drawer && (
        <SelectionGroup
          as="nav"
          label="Main navigation"
          value={page}
          className="sidebar-nav"
        >
          <button
            className={`nav-item assistant-nav ${page === "assistant" ? "selected" : ""}`}
            data-module="assistant"
            aria-label="Assistant"
            title={collapsed ? "Assistant" : undefined}
            aria-current={page === "assistant" ? "page" : undefined}
            onClick={() => go("assistant")}
          >
            <Sparkles size={21} />
            <span className="sidebar-label">Assistant</span>
            {reviewCount > 0 && (
              <span
                className="count"
                aria-label={`${reviewCount} suggestions to review`}
              >
                {reviewCount}
              </span>
            )}
          </button>
          <span className="nav-divider" aria-hidden="true" />
          <button
            className={`nav-item ${page === "money" ? "selected" : ""}`}
            data-module="money"
            aria-label="Money"
            title={collapsed ? "Money" : undefined}
            aria-current={page === "money" ? "page" : undefined}
            onClick={() => go("money")}
          >
            <Wallet size={21} />
            <span className="sidebar-label">Money</span>
          </button>
          <button
            className={`nav-item ${page === "tasks" ? "selected" : ""}`}
            data-module="tasks"
            aria-label="Tasks"
            title={
              collapsed
                ? `Tasks${dueCount ? ` · ${dueCount} due` : ""}`
                : undefined
            }
            aria-current={page === "tasks" ? "page" : undefined}
            onClick={() => go("tasks")}
          >
            <CheckCheck size={21} />
            <span className="sidebar-label">Tasks</span>
            {dueCount > 0 && (
              <span className="count" aria-label={`${dueCount} due`}>
                {dueCount}
              </span>
            )}
          </button>
        </SelectionGroup>
      )}
      <div className="sidebar-bottom">
        <div className="utility-actions">
          <button
            className="sidebar-utility"
            aria-label={`Theme: ${theme}. Change theme`}
            title={`Theme: ${theme}. Change theme`}
            onClick={onTheme}
          >
            {theme === "system" ? (
              <Monitor size={20} />
            ) : theme === "dark" ? (
              <Moon size={20} />
            ) : (
              <Sun size={20} />
            )}
            <span className="sidebar-label">Appearance</span>
            <span className="utility-value sidebar-label">{theme}</span>
          </button>
          <button
            className="sidebar-utility"
            aria-label="Export all data"
            title="Export all data"
            onClick={onExport}
            disabled={exportDisabled}
          >
            <Download size={20} />
            <span className="sidebar-label">Export data</span>
          </button>
        </div>
        <div className="workspace-label" title="Personal space">
          <span className="workspace-dot" />
          <span className="sidebar-label">Personal space</span>
        </div>
      </div>
    </div>
  );
}

export default function Navigation(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    previousOverflow = useRef<string | null>(null);
  const { mobileOpen, mobile, setMobileOpen } = props.navigation;
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  useLayoutEffect(() => {
    const element = dialog.current!;
    const close = () => {
      element.close();
      if (!mobile)
        document
          .querySelector<HTMLButtonElement>(
            '#desktop-navigation [aria-current="page"]',
          )
          ?.focus({ preventScroll: true });
      if (previousOverflow.current !== null) {
        document.body.style.overflow = previousOverflow.current;
        previousOverflow.current = null;
      }
    };
    if (mobile && mobileOpen) {
      if (previousOverflow.current === null)
        previousOverflow.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      if (!element.open) {
        element.showModal();
        element
          .querySelector<HTMLButtonElement>("[data-drawer-close]")
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (!element.open) return;
    if (!mobile || reduced || typeof element.animate !== "function") {
      close();
      return;
    }
    const animation = element.animate(
      [
        { transform: getComputedStyle(element).transform },
        { transform: "translateX(-100%)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    void animation.finished.then(close).catch(() => {});
    return () => animation.cancel();
  }, [mobileOpen, mobile, reduced]);
  useEffect(() => {
    const element = dialog.current!;
    return () => {
      element.close();
      if (previousOverflow.current !== null)
        document.body.style.overflow = previousOverflow.current;
    };
  }, []);
  const backdrop = useBackdropDismiss(() => setMobileOpen(false));
  return (
    <>
      <aside className="sidebar" id="desktop-navigation" aria-label="Sidebar">
        <SidebarContent {...props} />
      </aside>
      <dialog
        ref={dialog}
        id="mobile-navigation"
        className="navigation-drawer"
        aria-label="Navigation menu"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const elements = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "a[href], button:not(:disabled)",
            ),
          ].filter(
            (element) =>
              element.tabIndex >= 0 && element.getClientRects().length > 0,
          );
          const first = elements[0],
            last = elements.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setMobileOpen(false);
        }}
        {...backdrop}
      >
        <SidebarContent {...props} drawer />
      </dialog>
    </>
  );
}
