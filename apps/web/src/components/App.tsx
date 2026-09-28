import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../lib/query";
import { useInbox } from "./AssistantInbox";
import Assistant from "./Assistant";
import TaskCalendar from "./TaskCalendar";
import Money from "./Money";
import Navigation, { useNavigation } from "./Navigation";
import { flushSync } from "react-dom";
import { MotionView, useEntrance } from "./Motion";
import PageTitle from "./PageTitle";
import ModulePager, { type ModuleItem, type PagerControl } from "./ModulePager";
import Scrollbars from "./Scrollbars";
import { useAutoRefresh } from "./useAutoRefresh";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CheckCheck,
  Plus,
  Sparkles,
  Wallet,
  Menu,
  RefreshCw,
  Check,
  CircleAlert,
  X,
  Undo2,
} from "lucide-react";
import {
  request,
  today,
  deviceTimezone,
  dateLabel,
  type Snapshot,
  type Task,
} from "../lib/api";
import Editor, { newTask, type EditorState } from "./Editor";

type Page = "assistant" | "money" | "tasks";
const pages: Page[] = ["assistant", "money", "tasks"];
type Theme = "system" | "light" | "dark";
function pageFromHash(): Page {
  const hash = location.hash.slice(1);
  return hash === "tasks" || hash === "assistant" ? hash : "money";
}
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem("haven-theme");
    if (value === "light" || value === "dark") return value;
  } catch {}
  return "system";
}
function taskStatus(task: Task) {
  if (task.done) return "done";
  const day = today(task.timezone);
  return task.date < day ? "overdue" : task.date === day ? "today" : "upcoming";
}

export default function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Scrollbars />
      <Workspace />
    </QueryClientProvider>
  );
}
function Workspace() {
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const inbox = useInbox();
  const [assistantTab, setAssistantTab] = useState<"chat" | "inbox">("chat");
  const [page, setPage] = useState<Page>(pageFromHash),
    [theme, setTheme] = useState<Theme>(savedTheme);
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [editor, setEditor] = useState<EditorState | null>(null),
    [undo, setUndo] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    completionIDs = useRef(new Map<string, string>());
  const loaded = useRef(false);
  const moduleContent = useRef<HTMLDivElement>(null);
  // Page parts marked data-enter slide in once the page has its data.
  useEntrance(moduleContent, data ? page : null);
  const refresh = useCallback(
    async (options?: { background?: boolean; signal?: AbortSignal }) => {
      const current = ++generation.current;
      if (!options?.background || !loaded.current) setLoading(true);
      try {
        const state = await request<Snapshot>(
          `/state?entries=preview&month=${encodeURIComponent(month)}&timezone=${encodeURIComponent(deviceTimezone())}`,
          undefined,
          "GET",
          options?.signal,
        );
        if (current === generation.current && !options?.signal?.aborted) {
          loaded.current = true;
          setData(state);
          setRefreshError("");
          if (!options?.background) {
            setError("");
            await queryClient.invalidateQueries({ queryKey: ["activity"] });
          }
        }
      } catch (e) {
        if (
          current === generation.current &&
          !options?.signal?.aborted &&
          (!options?.background || !loaded.current)
        )
          setRefreshError((e as Error).message);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [month, queryClient],
  );
  const autoRefresh = useCallback(
    (signal: AbortSignal, initial: boolean) =>
      refresh({ background: !initial, signal }),
    [refresh],
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    [refresh],
  );
  // Poll faster while the assistant is reading or checking a task's notes.
  const followUpBusy = !!data?.tasks.some((task) =>
    ["reading", "checking"].includes(task.follow_up?.status ?? ""),
  );
  useAutoRefresh(autoRefresh, followUpBusy ? 3000 : 15000);
  useLayoutEffect(() => {
    document.documentElement.dataset.module = page;
  }, [page]);
  useEffect(() => {
    const listener = () => setPage(pageFromHash());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    update();
    media.addEventListener("change", update);
    try {
      localStorage.setItem("haven-theme", theme);
    } catch {}
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const dueCount =
    data?.tasks.filter(
      (t) =>
        !t.done &&
        !!t.date &&
        (t.plan?.kind === "scheduled" ||
          t.plan?.reminder_completed_on !== t.date) &&
        (!t.plan || t.plan.kind === "scheduled" || t.plan.remind) &&
        ["today", "overdue"].includes(taskStatus(t)),
    ).length ?? 0;
  function show(next: Page) {
    location.hash = next;
    setPage(next);
    setNotice("");
  }
  // On phones the pager slides to the module; elsewhere it just opens.
  function navigate(next: Page) {
    if (!pager.current?.go(next)) show(next);
  }
  const pager = useRef<PagerControl>(null);
  const modules: ModuleItem[] = [
    {
      id: "assistant",
      label: "Assistant",
      icon: <Sparkles size={22} />,
      count: inbox.count,
      countLabel: `${inbox.count} suggestions to review`,
    },
    { id: "money", label: "Money", icon: <Wallet size={22} /> },
    {
      id: "tasks",
      label: "Tasks",
      icon: <CheckCheck size={22} />,
      count: dueCount,
      countLabel: `${dueCount} due`,
    },
  ];
  const connecting = (
    <div className="empty">
      <RefreshCw className={loading ? "loading" : ""} />
      <h2>{loading ? "Opening your space…" : "Couldn’t connect"}</h2>
      {!loading && <p>Check that the Haven API is running, then retry.</p>}
    </div>
  );
  function renderModule(module: Page) {
    if (module === "assistant")
      return (
        <Assistant
          onNavigate={navigate}
          data={data}
          onEdit={setEditor}
          inbox={inbox}
          tab={assistantTab}
          onTab={setAssistantTab}
          onRefresh={refresh}
        />
      );
    if (module === "money")
      return data ? (
        <Money
          data={data}
          month={month}
          onMonth={setMonth}
          onEdit={setEditor}
          onRefresh={refresh}
          reviewCount={inbox.count}
          onReview={() => {
            setAssistantTab("inbox");
            navigate("assistant");
          }}
        />
      ) : (
        connecting
      );
    return (
      <>
        <section className="page-heading tasks-heading module-heading">
          <div className="page-title">
            <PageTitle
              icon={<CheckCheck size={22} />}
              title="Tasks"
              order={2}
            />
          </div>
          <button
            className="primary add-button"
            data-enter="right"
            aria-label="New task"
            disabled={!data}
            onClick={() => setEditor(newTask())}
          >
            <Plus />
            <span>New task</span>
          </button>
        </section>
        {data ? (
          <TaskCalendar
            tasks={data.tasks}
            busy={busy}
            onEdit={(task) => setEditor({ type: "task", record: task })}
            onComplete={complete}
            onAdd={(date) => setEditor(newTask(date))}
          />
        ) : (
          connecting
        )}
      </>
    );
  }
  // A dragged completion waits a moment for Undo before it is sent.
  const [completing, setCompleting] = useState<Task | null>(null);
  const waiting = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  function settleCompletion(confirmed: boolean) {
    if (!waiting.current) return;
    clearTimeout(waiting.current.timer);
    waiting.current.resolve(confirmed);
    waiting.current = null;
    setCompleting(null);
  }
  // Resolves whether it worked, so the list can bring a row back on failure or undo.
  async function complete(
    task: Task,
    options?: { undoable?: boolean },
  ): Promise<boolean> {
    if (options?.undoable) {
      settleCompletion(true);
      setUndo(null);
      setNotice("");
      setCompleting(task);
      const confirmed = await new Promise<boolean>((resolve) => {
        waiting.current = {
          resolve,
          timer: setTimeout(() => settleCompletion(true), 3000),
        };
      });
      if (!confirmed) return false;
    }
    setBusy(task.id);
    setNotice("");
    const key = `${task.id}:${task.version}`;
    let id = completionIDs.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      completionIDs.current.set(key, id);
    }
    try {
      const saved = await request<Task>(
        `/tasks/${task.id}/complete`,
        { id, version: task.version },
        "POST",
      );
      setNotice(
        saved.done ? "Completed" : `Completed · next ${dateLabel(saved.date)}`,
      );
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  async function restore() {
    if (!undo) return;
    setBusy("undo");
    try {
      await request(
        `/${undo.type === "entry" ? "entries" : "tasks"}/${undo.record.id}`,
        undo.record,
      );
      setUndo(null);
      setNotice("Restored");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function exportData() {
    setBusy("export");
    try {
      const backup = await request("/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `haven-${today()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  // Switching theme cross-fades the page.
  const cycleTheme = () => {
    const next =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    // Saved now: the change itself lands a frame later, inside the fade.
    try {
      localStorage.setItem("haven-theme", next);
    } catch {}
    if (
      !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return setTheme(next);
    document.documentElement.dataset.transition = "theme";
    document
      .startViewTransition(() => flushSync(() => setTheme(next)))
      .finished.finally(
        () => delete document.documentElement.dataset.transition,
      );
  };
  return (
    <div className="app-shell" data-sidebar-collapsed={navigation.collapsed}>
      <Navigation
        page={page}
        theme={theme}
        dueCount={dueCount}
        reviewCount={inbox.count}
        onNavigate={navigate}
        onTheme={cycleTheme}
        onExport={() => void exportData()}
        exportDisabled={!!busy || !data}
        navigation={navigation}
      />
      <main>
        {navigation.mobile && (
          <div className="mobile-navigation-controls">
            <button
              className="icon-button menu-trigger"
              aria-label="Open menu"
              title="Open menu"
              aria-haspopup="dialog"
              aria-expanded={navigation.mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => navigation.setMobileOpen(true)}
            >
              <Menu size={23} />
            </button>
          </div>
        )}
        <div className="module-content" ref={moduleContent}>
          {(error || refreshError) && (
            <div className="error-banner" role="alert">
              <CircleAlert />
              <span>{error || refreshError}</span>
              <button className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          <MotionView value={page} order={pages.indexOf(page)}>
            <ModulePager
              page={page}
              items={modules}
              onChange={(next) => show(next as Page)}
              render={(module) => renderModule(module as Page)}
              control={pager}
            />
          </MotionView>
          {completing ? (
            <div className="snackbar" role="status">
              <Check size={18} />
              <span>Completed</span>
              <button onClick={() => settleCompletion(false)}>
                <Undo2 size={18} />
                Undo
              </button>
              <button
                aria-label="Dismiss notification"
                onClick={() => settleCompletion(true)}
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            (notice || undo) && (
              <div className="snackbar" role="status">
                <Check size={18} />
                <span>{undo ? "Removed" : notice}</span>
                {undo && (
                  <button disabled={!!busy} onClick={() => void restore()}>
                    <Undo2 size={18} />
                    Undo
                  </button>
                )}
                <button
                  aria-label="Dismiss notification"
                  onClick={() => {
                    setUndo(null);
                    setNotice("");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )
          )}
          {editor && (
            <Editor
              key={editor.record.id}
              editor={editor}
              accounts={data?.accounts ?? []}
              categories={data?.categories ?? []}
              tagSuggestions={data?.tags ?? []}
              tasks={data?.tasks ?? []}
              onClose={() => setEditor(null)}
              onSaved={(undoState) => {
                setEditor(null);
                setUndo(undoState ?? null);
                setNotice(undoState ? "Removed" : "Saved");
                void inbox.refresh();
                void refresh();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
