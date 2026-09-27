import FormSelect from "./FormSelect";
import { useEffect, useState } from "react";
import {
  Building2,
  FlaskConical,
  Link2,
  RefreshCw,
  Unplug,
  X,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { request } from "../lib/api";
import type { components } from "../lib/api.generated";

type BankStatus = components["schemas"]["BankingStatus"];
type Bank = components["schemas"]["TestBank"];
type Amount = components["schemas"]["BankAmount"];
function bankAmount(value: Amount) {
  // Preserve provider decimal strings and currencies; never coerce bank amounts
  // through floating point. The Money ledger handles booked EUR amounts.
  return `${value.amount} ${value.currency}`;
}
export function useBankConnections(
  onSynced: () => Promise<void>,
  revision = 0,
) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selected, setSelected] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(location.search);
    const outcome = query.get("banking"),
      id = query.get("connection");
    if (outcome) {
      query.delete("banking");
      query.delete("connection");
      history.replaceState(
        null,
        "",
        `${location.pathname}${query.size ? `?${query}` : ""}${location.hash}`,
      );
    }
    async function load() {
      try {
        if (outcome === "connected" && id) {
          setNotice("Test bank connected. Loading its accounts…");
          setBusy(id);
          try {
            await request(
              `/banking/connections/${encodeURIComponent(id)}/refresh`,
              {},
              "POST",
            );
            if (active) {
              await onSynced();
              setNotice("Test bank connected and synced to Money.");
            }
          } catch (e) {
            if (active) {
              setNotice("Test bank connected. Refresh to load its accounts.");
              setError((e as Error).message);
            }
          }
        } else if (outcome === "cancelled")
          setNotice("Bank connection cancelled.");
        else if (outcome)
          setError("The test bank could not be connected. Please try again.");
        const data = await request<BankStatus>("/banking");
        if (active) setStatus(data);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setBusy("");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [revision]);
  async function chooseBank() {
    setChoosing(true);
    setBusy("banks");
    setError("");
    try {
      const { banks: available } = await request<{ banks: Bank[] }>(
        "/banking/banks",
      );
      setBanks(available);
      const preferred = available.findIndex((bank) => /mock/i.test(bank.name));
      setSelected(available.length ? String(Math.max(0, preferred)) : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function connect() {
    const bank = banks[Number(selected)];
    if (!bank) return;
    setBusy("connect");
    setError("");
    try {
      const { url } = await request<{ url: string }>(
        "/banking/authorize",
        { name: bank.name, country: bank.country },
        "POST",
      );
      location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  async function update(id: string, action: "refresh" | "disconnect") {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      setStatus(
        await request<BankStatus>(
          `/banking/connections/${id}/${action}`,
          {},
          "POST",
        ),
      );
      await onSynced();
      setNotice(
        action === "refresh"
          ? "Test accounts synced to Money."
          : "Test bank disconnected. Imported transactions are kept.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return {
    status,
    banks,
    selected,
    setSelected,
    choosing,
    setChoosing,
    busy,
    error,
    notice,
    chooseBank,
    connect,
    update,
  };
}

export default function BankConnections({
  controller,
}: {
  controller: ReturnType<typeof useBankConnections>;
}) {
  const {
    status,
    banks,
    selected,
    setSelected,
    choosing,
    setChoosing,
    busy,
    error,
    notice,
    chooseBank,
    connect,
    update,
  } = controller;
  return (
    <section
      className="bank-connections"
      aria-label="Bank connections"
      data-motion-block
    >
      <div className="section-heading">
        <h2>
          <Building2 size={20} /> Bank connections{" "}
          <span className="pill">
            <FlaskConical size={13} /> Sandbox
          </span>
        </h2>
        {status?.configured && (
          <button
            className="tonal"
            onClick={() => void chooseBank()}
            disabled={!!busy}
          >
            <Link2 size={18} /> Connect test bank
          </button>
        )}
      </div>
      <p className="bank-caption">
        Booked EUR transactions sync to Money. Pending payments stay here.
      </p>
      {!status?.configured && status && (
        <p className="bank-caption">
          Enable Banking setup is required before connecting a test bank.
        </p>
      )}
      {!status && !error && (
        <p className="bank-caption" role="status">
          Loading connections…
        </p>
      )}
      {error && (
        <p className="bank-message error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="bank-message" role="status">
          {notice}
        </p>
      )}
      {choosing && (
        <div className="bank-picker">
          <label>
            Test bank
            <FormSelect
              value={selected}
              disabled={!!busy || !banks.length}
              onChange={(e) => setSelected(e.target.value)}
            >
              {!banks.length && (
                <option value="">
                  {busy === "banks" ? "Loading…" : "No test banks available"}
                </option>
              )}
              {banks.map((bank, index) => (
                <option key={`${bank.country}:${bank.name}`} value={index}>
                  {bank.name} · {bank.country}
                </option>
              ))}
            </FormSelect>
          </label>
          <button
            className="primary"
            onClick={() => void connect()}
            disabled={!!busy || selected === ""}
          >
            <Link2 size={18} /> Continue
          </button>
          <button
            className="icon-button"
            aria-label="Cancel bank selection"
            title="Cancel"
            onClick={() => setChoosing(false)}
            disabled={!!busy}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="bank-connection-list">
        {status?.connections.map((connection) => (
          <article className="bank-connection" key={connection.id}>
            <div className="bank-connection-heading">
              <span className="icon-tile">
                <Building2 size={20} />
              </span>
              <div className="bank-connection-name">
                <h3>{connection.bank}</h3>
                <span className="muted">
                  {connection.status === "connected"
                    ? "Connected"
                    : connection.status === "expired"
                      ? "Expired · connect again"
                      : "Disconnected"}{" "}
                  · {connection.country}
                </span>
              </div>
              <div className="bank-actions">
                <button
                  className={`icon-button ${busy === connection.id ? "loading" : ""}`}
                  aria-label={`Refresh ${connection.bank}`}
                  title="Refresh test accounts"
                  disabled={
                    !!busy ||
                    !status.configured ||
                    connection.status !== "connected"
                  }
                  onClick={() => void update(connection.id, "refresh")}
                >
                  <RefreshCw size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Disconnect ${connection.bank}`}
                  title="Disconnect test bank"
                  disabled={
                    !!busy ||
                    !status.configured ||
                    connection.status === "disconnected"
                  }
                  onClick={() => void update(connection.id, "disconnect")}
                >
                  <Unplug size={18} />
                </button>
              </div>
            </div>
            <p className="bank-caption">
              {connection.synced_at
                ? `Updated ${new Date(connection.synced_at).toLocaleString()}`
                : "No account snapshot yet"}
              {connection.status === "connected" &&
                ` · Access until ${new Date(connection.valid_until).toLocaleDateString()}`}
            </p>
            {connection.accounts.map((item, index) => (
              <details
                className="bank-account"
                key={`${item.account.identification_hash}:${index}`}
              >
                <summary>
                  <span>
                    {item.account.details ||
                      item.account.name ||
                      "Test account"}
                  </span>
                  <span className="muted">
                    {item.account.currency} · {item.transactions.length}{" "}
                    transactions
                  </span>
                </summary>
                {item.account.account_id.iban && (
                  <p className="bank-caption">{item.account.account_id.iban}</p>
                )}
                <div className="bank-balances">
                  {item.balances.map((balance, i) => (
                    <div key={i}>
                      <span className="muted">
                        {balance.name || balance.balance_type}
                        {balance.reference_date &&
                          ` · ${balance.reference_date}`}
                      </span>
                      <strong>{bankAmount(balance.balance_amount)}</strong>
                    </div>
                  ))}
                </div>
                {!item.balances.length && (
                  <p className="bank-caption">
                    No balance supplied by the test bank.
                  </p>
                )}
                <ul
                  className="bank-transactions"
                  tabIndex={0}
                  aria-label="Test transactions"
                >
                  {item.transactions.map((transaction, i) => (
                    <li key={i}>
                      {transaction.credit_debit_indicator === "CRDT" ? (
                        <ArrowDownLeft size={18} />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                      <div>
                        <strong>
                          {transaction.credit_debit_indicator === "CRDT"
                            ? transaction.debtor.name || "Incoming payment"
                            : transaction.creditor.name || "Outgoing payment"}
                        </strong>
                        <span className="muted">
                          {transaction.booking_date ||
                            transaction.value_date ||
                            "Date not supplied"}{" "}
                          ·{" "}
                          {transaction.status === "BOOK"
                            ? "Booked"
                            : transaction.status === "PDNG"
                              ? "Pending"
                              : transaction.status}
                        </span>
                        {transaction.remittance_information?.length ? (
                          <span className="muted">
                            {transaction.remittance_information.join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      <span className="bank-amount">
                        {transaction.credit_debit_indicator === "DBIT" &&
                        !transaction.transaction_amount.amount.startsWith("-")
                          ? "−"
                          : ""}
                        {bankAmount(transaction.transaction_amount)}
                      </span>
                    </li>
                  ))}
                </ul>
                {!item.transactions.length && (
                  <p className="bank-caption">
                    No transactions supplied by the test bank.
                  </p>
                )}
              </details>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
