import FormSelect from "./FormSelect";
import AssistantDraftCard from "./AssistantDraftCard";
import TagChip from "./TagChip";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  LoaderCircle,
  MessageCircle,
  Plus,
  Square,
  Trash2,
  Wallet,
  Repeat2,
} from "lucide-react";
import {
  dateLabel,
  entryAmountTone,
  deviceTimezone,
  money,
  taskCost,
  costLabel,
  request,
  type Snapshot,
  type Task,
} from "../lib/api";
import type { components } from "../lib/api.generated";
import type { EditorState } from "./Editor";

type Status = components["schemas"]["AssistantStatus"];
type Reply = components["schemas"]["AssistantChatReply"];
type Message =
  components["schemas"]["AssistantChatRequest"]["messages"][number];
type Turn = { user: string; reply: Reply; history: string };
export default function AssistantChat({
  status,
  data,
  onEdit,
}: {
  status: Status;
  data: Snapshot | null;
  onEdit: (editor: EditorState) => void;
}) {
  const [input, setInput] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [entryID, setEntryID] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null),
    generation = useRef(0),
    end = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
    setPending("");
    setTurns([]);
    setError("");
  }, [status.settings.version, status.provider.version]);
  useEffect(() => {
    if (turns.length || pending)
      end.current?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
  }, [turns, pending]);
  const enabled =
    status.settings.mode !== "manual" &&
    !!status.provider.base_url &&
    !!status.provider.model &&
    Object.values(status.settings.skills).some(Boolean);
  const moneyEnabled =
    status.settings.skills["review-transaction"] ||
    status.settings.skills["organize-money"];
  async function send() {
    const text = input.trim();
    if (!text || busy || !enabled) return;
    setError("");
    setPending(text);
    setBusy(true);
    const current = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const history: Message[] = [];
    let historyBytes = 0;
    for (const turn of turns.slice(-8).reverse()) {
      const pair: Message[] = [
        { role: "user", content: turn.user },
        { role: "assistant", content: turn.history },
      ];
      historyBytes += new TextEncoder().encode(JSON.stringify(pair)).length;
      if (historyBytes > 24000) break;
      history.unshift(...pair);
    }
    const drafts = new Map<string, Task>();
    if (status.settings.skills["plan-task"]) {
      for (const turn of turns) {
        const task = turn.reply.task;
        if (
          task &&
          !data?.tasks.some(
            (existing) =>
              existing.id === task.id && existing.version > task.version,
          )
        )
          drafts.set(task.id, task);
      }
    }
    try {
      const reply = await request<Reply>(
        "/assistant/chat",
        {
          messages: [...history, { role: "user", content: text }],
          timezone: deviceTimezone(),
          task_drafts: [...drafts.values()].slice(-8),
          entry_ids: moneyEnabled && entryID ? [entryID] : [],
        },
        "POST",
        controller.signal,
      );
      if (current !== generation.current) return;
      // Keep structured drafts available to follow-up requests without inventing saved actions.
      const draftTask = reply.task;
      const context = JSON.stringify(
        draftTask
          ? {
              message: reply.message,
              skill_id: "plan-task",
              annotations: [],
              task: {
                id: draftTask.id,
                title: draftTask.title,
                date: draftTask.date,
                time: draftTask.time,
                repeat: draftTask.repeat,
                kind: draftTask.kind,
                amount_minor: draftTask.amount_minor,
                estimated_min_minor: draftTask.estimated_min_minor ?? null,
                estimated_max_minor: draftTask.estimated_max_minor ?? null,
                notes: draftTask.notes,
              },
            }
          : reply,
      );
      setTurns((previous) => [
        // Keep one actionable card for each draft; earlier revisions stay in
        // message history but cannot be saved accidentally.
        ...previous.map((turn) =>
          reply.task && turn.reply.task?.id === reply.task.id
            ? { ...turn, reply: { ...turn.reply, task: null } }
            : turn,
        ),
        {
          user: text,
          reply,
          history: context.length <= 10000 ? context : reply.message,
        },
      ]);
      setInput("");
    } catch (e) {
      if (current === generation.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setPending("");
        composer.current?.focus();
      }
    }
  }
  function stop() {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
    setPending("");
  }
  return (
    <section className="assistant-chat" aria-label="Assistant chat">
      <div className="assistant-chat-heading">
        <span>
          <MessageCircle size={18} />
          Conversation
        </span>
        <button
          type="button"
          className="icon-button"
          title="New conversation"
          aria-label="New conversation"
          disabled={busy || turns.length === 0}
          onClick={() => {
            setTurns([]);
            setError("");
            setEntryID("");
          }}
        >
          <Plus size={20} />
        </button>
      </div>
      <div
        className="assistant-conversation"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {turns.length === 0 && !busy && (
          <p className="assistant-chat-empty">
            Try “Barber next Friday at 16:30” or attach a transaction to review.
          </p>
        )}
        {turns.map((turn, index) => (
          <div className="assistant-turn" key={index}>
            <p className="assistant-user-message">{turn.user}</p>
            <p className="assistant-reply">{turn.reply.message}</p>
            {turn.reply.task &&
              (() => {
                const task = turn.reply.task!;
                const saved = data?.tasks.some(
                  (existing) =>
                    existing.id === task.id && existing.version > task.version,
                );
                return (
                  <AssistantDraftCard
                    icon={CalendarDays}
                    title={task.title}
                    details={
                      <>
                        {dateLabel(task.date)}
                        {task.time && ` · ${task.time}`}
                        {taskCost(task) && (
                          <span className="assistant-draft-note">
                            Est.{" "}
                            <span data-amount-tone="estimate">
                              {costLabel(...taskCost(task)!)}
                            </span>
                          </span>
                        )}
                      </>
                    }
                    label={`${saved ? "Task saved" : "Review task"}: ${task.title}`}
                    saved={saved}
                    disabled={!enabled}
                    onClick={() => onEdit({ type: "task", record: task })}
                  />
                );
              })()}
            {turn.reply.entries.map((entry) => {
              const saved = data?.entries.some(
                (existing) =>
                  existing.id === entry.id && existing.version > entry.version,
              );
              return (
                <AssistantDraftCard
                  key={entry.id}
                  icon={Wallet}
                  title={entry.payee || "Transaction"}
                  amount={money(entry.amount_minor)}
                  amountTone={entryAmountTone(entry)}
                  details={
                    <>
                      {entry.category || "Uncategorized"}
                      {entry.tags?.length ? (
                        <span className="draft-tags">
                          {entry.tags.map((tag) => (
                            <TagChip key={tag} tag={tag} />
                          ))}
                        </span>
                      ) : null}
                      {entry.payment && (
                        <span className="draft-schedule">
                          <Repeat2 size={13} />
                          {dateLabel(entry.payment.date)}
                        </span>
                      )}
                    </>
                  }
                  label={`${saved ? "Transaction updated" : "Review transaction"}: ${entry.payee || "Transaction"}`}
                  saved={saved}
                  disabled={!enabled}
                  onClick={() =>
                    onEdit({
                      type: "entry",
                      record: entry,
                      reviewReason: turn.reply.reasons?.[entry.id],
                    })
                  }
                />
              );
            })}
          </div>
        ))}
        {busy && (
          <div className="assistant-turn">
            <p className="assistant-user-message">{pending}</p>
            <p className="assistant-thinking">
              <LoaderCircle className="task-spinner" size={17} />
              Preparing your reply…
            </p>
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {moneyEnabled && (
          <label className="assistant-attachment">
            <Wallet size={16} />
            <span className="sr-only">Attach a transaction</span>
            <FormSelect
              aria-label="Attach a transaction"
              value={entryID}
              disabled={busy || !enabled}
              onChange={(e) => setEntryID(e.target.value)}
            >
              <option value="">Attach a transaction · optional</option>
              {data?.entries.slice(0, 200).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.date} · {entry.payee || "Transaction"} ·{" "}
                  <span data-amount-tone={entryAmountTone(entry)}>
                    {money(entry.amount_minor)}
                  </span>
                </option>
              ))}
            </FormSelect>
            {entryID && (
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label="Remove attached transaction"
                onClick={() => setEntryID("")}
              >
                <Trash2 size={15} />
              </button>
            )}
          </label>
        )}
        <div className="assistant-compose-row">
          <textarea
            ref={composer}
            aria-label="Message Haven"
            placeholder="Ask Haven…"
            rows={2}
            maxLength={6000}
            value={input}
            disabled={!enabled || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="icon-button tonal"
              aria-label="Stop reply"
              onClick={stop}
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              className="icon-button primary"
              aria-label="Send message"
              disabled={!enabled || !input.trim()}
            >
              <ArrowUp size={20} />
            </button>
          )}
        </div>
      </form>
      <p className="helper">
        Drafts change nothing until you save. Conversations last until you leave
        this page.
      </p>
    </section>
  );
}
