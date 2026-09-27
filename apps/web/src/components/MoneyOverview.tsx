import { useId, useState, type CSSProperties, type MouseEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Wallet,
} from "lucide-react";
import MoneyText from "./MoneyText";
import { BankLogo } from "./BrandIcon";
import UpcomingCosts, { PlanActions } from "./UpcomingCosts";
import { costLabel, money, type Account, type Snapshot } from "../lib/api";
import type { EditorState } from "./Editor";

function hue(name: string) {
  let hash = 0;
  for (const char of name.trim().toLowerCase())
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return [152, 28, 256, 340, 200, 75, 300, 12][hash % 8];
}

function AccountAvatar({ account }: { account: Account }) {
  return (
    <span
      className="account-avatar"
      style={{ "--avatar-hue": hue(account.name) } as CSSProperties}
      aria-hidden="true"
    >
      {account.name.trim().charAt(0).toUpperCase() || "·"}
      {account.source && <BankLogo id={account.id} />}
    </span>
  );
}

// One card: balance, month flow and the 30-day estimate at a glance; the
// whole card expands for accounts and upcoming plans. The accounts stack in
// the glance steps aside while the card is open, where the accounts row
// shows the same accounts.
export default function MoneyOverview({
  data,
  onEdit,
  onRefresh,
}: {
  data: Snapshot;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const detailsID = useId();
  const accounts = data.accounts;
  const incomeMinor = BigInt(data.income_minor),
    spendingMinor = BigInt(data.spending_minor);
  const income = Number(incomeMinor),
    spending = Number(spendingMinor);
  // Bar geometry is display only; every amount shown is exact.
  const share = income > 0 ? spending / income : spending ? 1 : 0;
  const over = income > 0 && spending > income;
  const heat = share >= 0.85 ? "hot" : share >= 0.5 ? "warm" : "calm";
  const percent = income > 0 ? Math.round(share * 100) : null;
  const overBy = over ? money((spendingMinor - incomeMinor).toString()) : "";
  const upcoming = data.upcoming;
  function glanceClick(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest("button")) setOpen(!open);
  }
  return (
    <section
      className="money-overview"
      aria-label="Money overview"
      data-open={open}
      data-motion-block
    >
      <div className="overview-glance" onClick={glanceClick}>
        <p className="overview-balance">
          <span className="sr-only">Total balance </span>
          <strong className="money-total" data-testid="total-balance">
            <MoneyText text={money(data.total_minor)} />
          </strong>
        </p>
        {accounts.length > 0 && (
          <span
            className="account-stack"
            title={`${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
          >
            <span className="account-stack-avatars">
              {accounts.slice(0, 3).map((a) => (
                <AccountAvatar key={a.id} account={a} />
              ))}
            </span>
            <span aria-hidden="true">{accounts.length}</span>
            <span className="sr-only">
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </span>
        )}
        <button
          className="overview-toggle"
          aria-expanded={open}
          aria-controls={detailsID}
          aria-label={open ? "Hide money details" : "Show money details"}
          title={open ? "Less" : "More"}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={20} />
        </button>
        <div className="overview-flow-row">
          <div
            className="heat-bar"
            data-heat={heat}
            data-over={over || undefined}
            style={
              {
                "--heat-share": Math.min(share, 1),
                "--heat-income": over ? income / spending : 1,
              } as CSSProperties
            }
          >
            <dl className="overview-flow" aria-label="Monthly totals">
              <div title="Spending this month">
                <dt>
                  <ArrowUpRight size={15} data-amount-tone="spending" />
                  <span className="sr-only">Spending</span>
                </dt>
                <dd data-testid="spending-total" data-amount-tone="spending">
                  <MoneyText text={money(data.spending_minor)} />
                </dd>
              </div>
              <div className="heat-income" title="Income this month">
                <dt>
                  <ArrowDownLeft size={15} data-amount-tone="income" />
                  <span className="sr-only">Income</span>
                </dt>
                <dd data-testid="income-total" data-amount-tone="income">
                  <MoneyText text={money(data.income_minor)} />
                </dd>
              </div>
            </dl>
            <span
              className="heat-track"
              role="img"
              aria-label={
                percent === null
                  ? "No income this month"
                  : `Spent ${percent}% of this month's income${over ? `, ${overBy} over` : ""}`
              }
            >
              <span className="heat-fill" />
            </span>
            <span className="heat-over" aria-hidden="true">
              <i />
              <span>
                +<MoneyText text={overBy} />
              </span>
            </span>
          </div>
          {upcoming && (
            <dl
              className="overview-estimate"
              title="Estimated spending · next 30 days"
            >
              <dt>
                <CalendarClock size={15} data-amount-tone="estimate" />
                <span className="sr-only">
                  Estimated spending, next 30 days
                </span>
              </dt>
              <dd>
                {/* Collapsed: one figure, the top of the estimate. Expanded:
                    the full range. */}
                <span data-testid="upcoming-total" data-amount-tone="estimate">
                  {open ? (
                    <MoneyText
                      text={costLabel(
                        upcoming.minimum_minor,
                        upcoming.maximum_minor,
                      )}
                    />
                  ) : (
                    <>
                      {upcoming.minimum_minor !== upcoming.maximum_minor && (
                        <>
                          <span className="estimate-bound" aria-hidden="true">
                            ≈
                          </span>
                          <span className="sr-only">about </span>
                        </>
                      )}
                      <MoneyText text={money(upcoming.maximum_minor)} />
                    </>
                  )}
                </span>
                {upcoming.unknown_count > 0 && (
                  <span
                    className="overview-unknown"
                    title={`${upcoming.unknown_count} without a price yet`}
                  >
                    +{upcoming.unknown_count}
                    <CircleHelp size={12} aria-hidden="true" />
                    <span className="sr-only"> without a price yet</span>
                  </span>
                )}
              </dd>
            </dl>
          )}
        </div>
      </div>
      <div id={detailsID} className="overview-details" inert={!open}>
        <div className="overview-details-inner">
          <section className="overview-accounts" aria-label="Accounts">
            {accounts.length > 0 && (
              <h3 title="Accounts">
                <Wallet size={16} aria-hidden="true" />
                <span className="sr-only">Accounts</span>
              </h3>
            )}
            {/* Overlapping at rest; hovering spreads them, each with its
                balance. Display only: the activity list has its own filter. */}
            <div className="account-row" tabIndex={accounts.length ? 0 : -1}>
              {accounts.map((a) => (
                <span
                  key={a.id}
                  className="account-chip"
                  title={`${a.name}${a.source ? " · Bank sandbox" : ""}`}
                >
                  <AccountAvatar account={a} />
                  <span className="sr-only">{a.name} </span>
                  <strong
                    data-amount-tone={
                      data.balances[a.id]?.startsWith("-")
                        ? "spending"
                        : undefined
                    }
                  >
                    <MoneyText text={money(data.balances[a.id] ?? "0")} />
                  </strong>
                </span>
              ))}
            </div>
            <PlanActions data={data} onEdit={onEdit} onRefresh={onRefresh} />
          </section>
          <UpcomingCosts data={data} onEdit={onEdit} onRefresh={onRefresh} />
        </div>
      </div>
    </section>
  );
}
