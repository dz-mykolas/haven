import VirtualFeed, { type FeedRow } from "./VirtualFeed";
import { useActivity } from "./useActivity";
import FormSelect from "./FormSelect";
import MoneyOverview from "./MoneyOverview";
import BrandIcon from "./BrandIcon";
import MoneyText from "./MoneyText";
import PageTitle from "./PageTitle";
import RemoveAccount from "./RemoveAccount";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Wallet,
  WalletCards,
  Inbox,
  Plus,
  Search,
  SlidersHorizontal,
  X,
  Pencil,
  Link2,
  Trash2,
} from "lucide-react";
import {
  dateLabel,
  money,
  entryAmountTone,
  type Snapshot,
  type Account,
} from "../lib/api";
import { newAccount, newEntry, type EditorState } from "./Editor";
import CategoryManager from "./CategoryManager";
import BankConnections, { useBankConnections } from "./BankConnections";

export default function Money({
  data,
  month,
  onMonth,
  onEdit,
  onRefresh,
  reviewCount,
  onReview,
}: {
  data: Snapshot;
  month: string;
  onMonth: (month: string) => void;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
  reviewCount: number;
  onReview: () => void;
}) {
  const [managing, setManaging] = useState(() =>
    new URLSearchParams(location.search).has("banking"),
  );
  const [bankRevision, setBankRevision] = useState(0);
  const bank = useBankConnections(onRefresh, bankRevision);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const filters = { month, search: debouncedSearch, account, category, tag };
  const activity = useActivity(filters);
  const loadMore = useCallback(
    () => activity.fetchNextPage({ cancelRefetch: false }),
    [activity.fetchNextPage],
  );
  const panel = useRef<HTMLDivElement>(null);
  const manageButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const manualAccounts = data.accounts.filter((a) => !a.source);
  const accountName = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name ?? "Removed account";
  const rows: FeedRow[] = [];
  const entries = activity.entries;
  // Each day's net (income less spending; transfers move money, so they
  // don't count), shown once the whole day has loaded.
  const dayTotals = new Map<string, bigint>();
  for (const e of entries) {
    if (e.kind === "transfer") continue;
    const sign = e.kind === "income" ? 1n : -1n;
    dayTotals.set(
      e.date,
      (dayTotals.get(e.date) ?? 0n) + sign * BigInt(e.amount_minor),
    );
  }
  const loadedThrough = activity.hasNextPage ? entries.at(-1)?.date : "";
  entries.forEach((e, index) => {
    // Rows of one day join into a single rounded group.
    const first = entries[index - 1]?.date !== e.date,
      last = entries[index + 1]?.date !== e.date;
    if (first) {
      const total = e.date !== loadedThrough ? dayTotals.get(e.date) : null;
      rows.push({
        key: `date:${e.date}`,
        estimate: 42,
        content: (
          <div className="activity-day">
            <h3>{dateLabel(e.date)}</h3>
            {total != null && total !== 0n && (
              <span
                className="activity-day-total"
                data-amount-tone={total > 0n ? "income" : undefined}
              >
                <span className="sr-only">Day total </span>
                <MoneyText
                  text={`${total > 0n ? "+" : ""}${money(total.toString())}`}
                />
              </span>
            )}
          </div>
        ),
      });
    }
    rows.push({
      key: e.id,
      estimate: 78,
      content: (
        <button
          className="transaction-row"
          key={e.id}
          data-group-start={first || undefined}
          data-group-end={last || undefined}
          aria-label={`${e.source ? "View" : "Edit"} ${e.payee || e.kind}`}
          onClick={() => onEdit({ type: "entry", record: e })}
        >
          <span className={`icon-tile ${e.kind}`}>
            {e.kind === "transfer" ? (
              <ArrowRightLeft size={20} />
            ) : (
              <BrandIcon
                name={e.payee}
                fallback={
                  e.kind === "income" ? (
                    <ArrowDownLeft size={20} />
                  ) : (
                    <ArrowUpRight size={20} />
                  )
                }
              />
            )}
          </span>
          <span className="transaction-description">
            <strong>
              {e.payee ||
                (e.kind === "transfer"
                  ? "Transfer"
                  : e.kind === "income"
                    ? "Income"
                    : "Expense")}
            </strong>
            <small>
              {accountName(e.account_id)}
              {e.kind === "transfer" && ` → ${accountName(e.destination_id)}`}
            </small>
          </span>
          {e.category && <span className="category">{e.category}</span>}
          <strong
            className={`amount ${e.kind}`}
            data-amount-tone={entryAmountTone(e)}
          >
            {e.kind === "income" ? "+" : e.kind === "expense" ? "−" : ""}
            {money(e.amount_minor)}
          </strong>
        </button>
      ),
    });
  });
  useEffect(() => {
    if (filtersOpen) searchInput.current?.focus();
  }, [filtersOpen]);
  function editFromPanel(editor: EditorState) {
    // Keep the account panel mounted behind the editor.
    onEdit(editor);
  }
  return (
    <div className="money-home">
      <header className="money-heading module-heading">
        <div className="money-title">
          <PageTitle icon={<Wallet size={22} />} title="Money" order={1} />
          <label className="money-month" data-enter="top">
            <span className="sr-only">Reporting month</span>
            <input
              type="month"
              value={month}
              min="1900-01"
              max="9998-12"
              onChange={(e) => {
                if (e.target.value) onMonth(e.target.value);
              }}
            />
          </label>
        </div>
        <div className="money-heading-actions" data-enter="right">
          {reviewCount > 0 && (
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="money-review-button"
                    aria-label={`Review suggestions · ${reviewCount}`}
                    onClick={onReview}
                  >
                    <Inbox className="size-5" aria-hidden="true" />
                    <Badge className="money-review-count" aria-hidden="true">
                      {reviewCount > 999 ? "999+" : reviewCount}
                    </Badge>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  Review suggestions
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <button
            ref={manageButton}
            className="icon-button"
            aria-label="Manage accounts"
            title="Accounts & banks"
            aria-haspopup="dialog"
            onClick={() => setManaging(true)}
          >
            <WalletCards size={21} />
          </button>
          <button
            className="primary money-add"
            aria-label={
              manualAccounts.length ? "Add transaction" : "Add account"
            }
            title={manualAccounts.length ? "Add transaction" : "Add account"}
            onClick={() =>
              onEdit(
                manualAccounts.length
                  ? newEntry(manualAccounts[0].id)
                  : newAccount(),
              )
            }
          >
            <Plus size={21} />
            <span>
              {manualAccounts.length ? "Add transaction" : "Add account"}
            </span>
          </button>
        </div>
      </header>
      {!data.accounts.length && (
        <section
          className="money-welcome"
          aria-label="Get started"
          data-motion-block
        >
          <span className="icon-tile">
            <Wallet size={24} />
          </span>
          <div>
            <h2>Your money, in one place</h2>
            <p>Connect a bank or add an account to get started.</p>
          </div>
          <button className="tonal" onClick={() => setManaging(true)}>
            <Link2 size={18} />
            Connect a bank
          </button>
        </section>
      )}
      <MoneyOverview data={data} onEdit={onEdit} onRefresh={onRefresh} />
      <section
        className="money-activity"
        aria-label="Transactions"
        data-motion-block
      >
        <div className="activity-heading">
          <h2>
            Activity <span className="subtle-count">{activity.total}</span>
          </h2>
          <button
            className={`icon-button ${filtersOpen ? "tonal" : ""}`}
            aria-label="Search and filter transactions"
            title="Search & filter"
            aria-expanded={filtersOpen}
            aria-controls="money-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={19} />
          </button>
        </div>
        {filtersOpen && (
          <div className="activity-filters" id="money-filters">
            <label className="search">
              <Search size={18} />
              <input
                ref={searchInput}
                aria-label="Search transactions"
                placeholder="Search transactions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <FormSelect
              aria-label="Filter account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">All accounts</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              aria-label="Filter category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              <option value="uncategorized">Uncategorized</option>
              {(data.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              aria-label="Filter tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">All tags</option>
              {(data.tags ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </FormSelect>
          </div>
        )}
        {(search || account || category || tag) && (
          <div className="active-money-filters" role="status">
            <span>
              {[
                account ? accountName(account) : "",
                category === "uncategorized"
                  ? "Uncategorized"
                  : (data.categories ?? []).find((c) => c.id === category)
                      ?.name,
                tag ? `#${tag}` : "",
                search ? `“${search}”` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <button
              className="icon-button"
              title="Clear filters"
              aria-label="Clear transaction filters"
              onClick={() => {
                setSearch("");
                setAccount("");
                setCategory("");
                setTag("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {activity.error && !activity.isFetchNextPageError && (
          <div role="alert" className="error-banner">
            {activity.error.message}
            <Button variant="ghost" onClick={() => void activity.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {activity.isPending ? (
          <p role="status" className="helper">
            Loading transactions…
          </p>
        ) : activity.entries.length ? (
          <VirtualFeed
            rows={rows}
            label="Transactions"
            resetKey={JSON.stringify(filters)}
            hasNextPage={activity.hasNextPage}
            fetching={activity.isFetching}
            nextError={
              activity.isFetchNextPageError
                ? activity.error?.message
                : undefined
            }
            loadMore={loadMore}
          />
        ) : (
          !activity.error && (
            <div className="activity-empty">
              <ArrowRightLeft size={26} />
              <h3>
                {search || account || category || tag
                  ? "No matching transactions"
                  : "No activity this month"}
              </h3>
              <p>
                {search || account || category || tag
                  ? "Try another search or account."
                  : "Your transactions will appear here."}
              </p>
            </div>
          )
        )}
      </section>
      <Dialog open={managing} onOpenChange={setManaging}>
        <DialogContent
          ref={panel}
          className="money-panel"
          aria-labelledby="money-panel-title"
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            manageButton.current?.focus();
          }}
        >
          <div className="money-panel-heading">
            <div>
              <span className="eyebrow">MONEY</span>
              <DialogTitle id="money-panel-title">Accounts & banks</DialogTitle>
            </div>
            <button
              autoFocus
              className="icon-button"
              aria-label="Close accounts"
              title="Close"
              onClick={() => setManaging(false)}
            >
              <X size={21} />
            </button>
          </div>
          <section className="managed-accounts" aria-label="Your accounts">
            <div className="section-heading">
              <h3>Accounts</h3>
              <button
                className="icon-button tonal"
                title="Add account"
                aria-label="Add account"
                onClick={() => editFromPanel(newAccount())}
              >
                <Plus size={19} />
              </button>
            </div>
            {data.accounts.map((a) => (
              <div className="managed-account" key={a.id}>
                <button
                  className="managed-account-info"
                  aria-label={`Show transactions for ${a.name}`}
                  onClick={() => {
                    setAccount(a.id);
                    setManaging(false);
                  }}
                >
                  <span className="account-symbol">
                    <Wallet size={19} />
                  </span>
                  <span>
                    <strong>{a.name}</strong>
                    <small>
                      {a.source ? "Bank synced · Sandbox" : "Manual"}
                    </small>
                  </span>
                  <strong className="managed-balance">
                    {money(data.balances[a.id])}
                  </strong>
                </button>
                <button
                  className="icon-button danger"
                  title={`Remove ${a.name}`}
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setRemoving(a)}
                >
                  <Trash2 size={16} />
                </button>
                {!a.source && (
                  <button
                    className="icon-button"
                    title={`Edit ${a.name}`}
                    aria-label={`Edit ${a.name}`}
                    onClick={() =>
                      editFromPanel({ type: "account", record: a })
                    }
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
            ))}
            {!data.accounts.length && (
              <p className="bank-caption">
                Add a manual account or connect a bank below.
              </p>
            )}
          </section>
          <BankConnections controller={bank} />
          <CategoryManager
            categories={data.categories ?? []}
            onSaved={onRefresh}
          />
        </DialogContent>
      </Dialog>
      {removing && (
        <RemoveAccount
          account={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            await onRefresh();
            setBankRevision((value) => value + 1);
            if (account === removing.id) setAccount("");
            setRemoving(null);
            panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }}
        />
      )}
    </div>
  );
}
