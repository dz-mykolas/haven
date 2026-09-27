import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { request, type Account } from "../lib/api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export default function RemoveAccount({
  account,
  onClose,
  onRemoved,
}: {
  account: Account;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(
        `/accounts/${account.id}`,
        { version: account.version },
        "DELETE",
      );
      await onRemoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="remove-account-dialog"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="dialog-heading">
          <span className="icon-tile danger">
            <Trash2 />
          </span>
          <DialogTitle>Remove {account.name}?</DialogTitle>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <DialogDescription className="helper">
          Removes this account, its balance and activity from Money. Transfers
          involving your other accounts stay in their history.
          {account.source
            ? " Sync will skip this account. Your bank account is unchanged."
            : ""}
        </DialogDescription>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            autoFocus
            className="text-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary remove-account-confirm"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 size={18} />
            {busy ? "Removing…" : "Remove account"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
