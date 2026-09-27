import { useInfiniteQuery } from "@tanstack/react-query";
import VirtualFeed, { type FeedRow } from "./VirtualFeed";
import { useCallback, useMemo, useState } from "react";
import {
  CheckCheck,
  Inbox,
  ArrowUpRight,
  RefreshCw,
  MoreHorizontal,
  X,
  Repeat2,
  Tag,
  ShoppingBag,
  Sparkles,
  Undo2,
  MessageCircleQuestion,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { entryAmountTone } from "../lib/api";
import TagChip from "./TagChip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { dateLabel, money, request, type Account } from "../lib/api";
import type { components } from "../lib/api.generated";
import type { EditorState } from "./Editor";

type InboxData = components["schemas"]["ReviewInbox"];
type Item = components["schemas"]["ReviewItem"];
export function useInbox() {
  const [view, setView] = useState<"review" | "history">("review");
  const query = useInfiniteQuery({
    queryKey: ["inbox", view],
    queryFn: ({ pageParam, signal }) =>
      request<InboxData>(
        `/assistant/inbox?view=${view}&cursor=${encodeURIComponent(pageParam)}`,
        undefined,
        "GET",
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    refetchInterval: 6000,
  });
  const data = useMemo(() => {
    if (!query.data) return null;
    const unique = new Map<string, Item>();
    for (const page of query.data.pages)
      for (const item of page.items)
        if (!unique.has(item.entry_id)) unique.set(item.entry_id, item);
    return { ...query.data.pages[0], items: [...unique.values()] };
  }, [query.data]);
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);
  const loadMore = useCallback(
    () => query.fetchNextPage({ cancelRefetch: false }),
    [query.fetchNextPage],
  );
  return {
    data,
    error: query.error?.message ?? "",
    view,
    setView,
    refresh,
    loadMore,
    hasNextPage: query.hasNextPage,
    fetching: query.isFetching,
    nextError: query.isFetchNextPageError ? query.error?.message : undefined,
  };
}
export type InboxController = ReturnType<typeof useInbox>;
const historyLabels: Record<string, string> = {
  auto_applied: "Automatically categorized",
  undone: "Undone",
  completed: "Updated",
  dismissed: "Dismissed",
  unchanged: "No suggestion",
  stale: "Transaction changed or removed",
};
export default function AssistantInbox({
  inbox,
  onEdit,
  accounts,
  onRefresh,
}: {
  inbox: InboxController;
  accounts: Account[];
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
}) {
  const { data, view } = inbox;
  const [question, setQuestion] = useState<Item | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(path: string, id: string) {
    setBusy(id);
    setError("");
    try {
      await request(path, {}, "POST");
      await inbox.refresh();
      if (path.endsWith("/undo")) await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function answerQuestion() {
    if (!question) return;
    setBusy(question.entry_id);
    setError("");
    try {
      await request(
        `/assistant/inbox/${question.entry_id}/answer`,
        { answer },
        "POST",
      );
      await inbox.refresh();
      setQuestion(null);
      setAnswer("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const renderItem = (item: Item) => {
    const draft = item.draft;
    const title = item.original.payee || "Transaction";
    const Icon =
      draft?.category === "Recurring"
        ? Repeat2
        : draft?.category === "Everyday"
          ? ShoppingBag
          : draft?.category === "Occasional"
            ? Sparkles
            : Tag;
    const review = () => {
      if (item.question) {
        setAnswer("");
        setError("");
        setQuestion(item);
        return;
      }
      onEdit({
        type: "entry",
        record: draft!,
        review: true,
        reviewReason: item.reason,
      });
    };
    const content = (
      <>
        <span className="review-symbol">
          <Icon size={22} aria-hidden="true" />
        </span>
        <span className="review-content">
          <span className="review-title">
            <strong>{title}</strong>
            <strong
              className="review-amount"
              data-amount-tone={entryAmountTone(draft ?? item.original)}
            >
              {item.original.kind === "expense" ? "−" : "+"}
              {money(item.original.amount_minor)}
            </strong>
          </span>
          <span className="review-meta">
            {dateLabel(item.original.date)}
            <span>·</span>
            {accounts.find((a) => a.id === item.original.account_id)?.name ??
              "Removed account"}
          </span>
          <span className="review-changes">
            {view === "review" && item.question ? (
              <span className="review-question">
                <MessageCircleQuestion size={14} />
                {item.question}
              </span>
            ) : view === "review" && draft ? (
              <>
                <span className="category-cue">
                  <Icon size={13} />
                  {draft.category || "Uncategorized"}
                </span>
                <span className="review-tags" aria-label="Suggested tags">
                  {(draft.tags ?? [])
                    .filter(
                      (tag) =>
                        !(item.original.tags ?? []).some(
                          (old) => old.toLowerCase() === tag.toLowerCase(),
                        ),
                    )
                    .slice(0, 2)
                    .map((tag) => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                </span>
                {draft.payment && (
                  <span className="review-next">
                    <Repeat2 size={13} />
                    {dateLabel(draft.payment.date)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>{historyLabels[item.status] ?? item.status}</span>
                {item.status === "auto_applied" && draft?.category && (
                  <span className="category-cue">{draft.category}</span>
                )}
                {item.status === "auto_applied" && draft && (
                  <span className="review-tags" aria-label="Applied tags">
                    {(draft.tags ?? [])
                      .filter(
                        (tag) => !(item.original.tags ?? []).includes(tag),
                      )
                      .slice(0, 2)
                      .map((tag) => (
                        <TagChip key={tag} tag={tag} />
                      ))}
                  </span>
                )}
              </>
            )}
          </span>
        </span>
        {view === "review" && draft && (
          <ArrowUpRight className="review-open" size={19} aria-hidden="true" />
        )}
      </>
    );
    return (
      <article className="inbox-item" key={item.entry_id}>
        {view === "review" && draft ? (
          <Button
            variant="ghost"
            className="review-card"
            disabled={!!busy}
            aria-label={`Review ${title}`}
            onClick={review}
          >
            {content}
          </Button>
        ) : (
          <div className="review-card">{content}</div>
        )}
        {((view === "review" && draft) || item.can_undo) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="review-menu"
                aria-label={`More options for ${title}`}
                disabled={!!busy}
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {view === "review" && (
                <DropdownMenuItem
                  onSelect={() =>
                    void act(
                      `/assistant/inbox/${item.entry_id}/dismiss`,
                      item.entry_id,
                    )
                  }
                  aria-label={`Dismiss ${title}`}
                >
                  <X size={16} />
                  Dismiss
                </DropdownMenuItem>
              )}
              {item.can_undo && (
                <DropdownMenuItem
                  onSelect={() =>
                    void act(
                      `/assistant/inbox/${item.entry_id}/undo`,
                      item.entry_id,
                    )
                  }
                  aria-label={`Undo categorization for ${title}`}
                >
                  <Undo2 size={16} />
                  Undo categorization
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </article>
    );
  };
  const rows: FeedRow[] = [];
  let previousMonth = "";
  for (const item of data?.items ?? []) {
    const month = item.original.date.slice(0, 7);
    if (month !== previousMonth) {
      previousMonth = month;
      rows.push({
        key: `month:${month}`,
        estimate: 44,
        content: (
          <div className="inbox-month">
            <h2>
              {new Intl.DateTimeFormat(undefined, {
                month: "long",
                year: "numeric",
              }).format(new Date(`${month}-15T12:00:00`))}
            </h2>
          </div>
        ),
      });
    }
    rows.push({ key: item.entry_id, estimate: 124, content: renderItem(item) });
  }
  return (
    <section className="assistant-inbox" aria-label="Transaction inbox">
      <div className="inbox-heading">
        <div className="segments" aria-label="Inbox view">
          <button
            aria-pressed={view === "review"}
            onClick={() => inbox.setView("review")}
          >
            To review
          </button>
          <button
            aria-pressed={view === "history"}
            onClick={() => inbox.setView("history")}
          >
            History
          </button>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh inbox"
          onClick={() => void inbox.refresh()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {(error || inbox.error) && (
        <div className="error-banner" role="alert">
          {error || inbox.error}
          <button className="text-button" onClick={() => void inbox.refresh()}>
            Retry
          </button>
        </div>
      )}
      {data && !data.enabled && (
        <p className="inbox-status">
          Automatic categorization paused · manage in Preferences.
        </p>
      )}
      {data && data.pending_count > 0 && (
        <p className="inbox-status" role="status">
          {data.enabled ? "Organizing" : "Paused with"} {data.pending_count}{" "}
          transaction{data.pending_count === 1 ? "" : "s"}
          {data.enabled ? "…" : " waiting."}
        </p>
      )}
      {data && data.failed_count > 0 && (
        <div className="inbox-status">
          {data.failed_count} transaction
          {data.failed_count === 1 ? " couldn’t" : "s couldn’t"} be reviewed.
          Check your model connection, then try again.{" "}
          <button
            className="text-button"
            disabled={!!busy || !data.enabled}
            onClick={() => void act("/assistant/inbox/retry", "retry")}
          >
            {busy === "retry" ? "Retrying…" : "Retry failed reviews"}
          </button>
        </div>
      )}
      {!data && !inbox.error && (
        <p role="status" className="helper">
          Loading inbox…
        </p>
      )}
      {data && data.items.length === 0 && (
        <div className="inbox-empty">
          {view === "review" ? <Inbox size={30} /> : <CheckCheck size={30} />}
          <h2>
            {view === "history"
              ? "No activity yet"
              : data.pending_count && data.enabled
                ? "Organizing your transactions"
                : "Nothing to review"}
          </h2>
          <p>
            {view === "history"
              ? "Automatic categories and your schedule decisions appear here."
              : data.pending_count && data.enabled
                ? "You can leave this page while Haven works."
                : "Categories apply automatically. New plans and purchase questions appear here."}
          </p>
        </div>
      )}
      <VirtualFeed
        rows={rows}
        label="Inbox items"
        resetKey={view}
        hasNextPage={inbox.hasNextPage}
        fetching={inbox.fetching}
        nextError={inbox.nextError}
        loadMore={inbox.loadMore}
      />
      <Dialog
        open={!!question}
        onOpenChange={(open) => {
          if (!open && !busy) setQuestion(null);
        }}
      >
        <DialogContent
          className="purchase-question-dialog"
          aria-describedby={undefined}
          showCloseButton={!busy}
        >
          <DialogTitle>
            {question?.original.payee || "Clarify purchase"}
          </DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void answerQuestion();
            }}
          >
            <label className="field">
              <span>{question?.question}</span>
              <Input
                aria-label="Your answer"
                required
                maxLength={1000}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g. Four Welkins for my account"
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!!busy || !answer.trim()}>
              {busy ? "Sending…" : "Send answer"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
