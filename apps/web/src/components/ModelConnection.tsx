import FormSelect from "./FormSelect";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  KeyRound,
  Link,
  LoaderCircle,
  Plug,
  Trash2,
  X,
} from "lucide-react";
import { request } from "../lib/api";
import type { components } from "../lib/api.generated";
import { useBackdropDismiss } from "./useBackdropDismiss";

type Status = components["schemas"]["AssistantStatus"];
type Provider = components["schemas"]["AssistantProvider"];
export default function ModelConnection({
  status,
  onUpdated,
}: {
  status: Status;
  onUpdated: (status: Status) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const provider = status.provider;
  async function test() {
    setBusy(true);
    setError("");
    try {
      onUpdated(
        await request<Status>(
          "/assistant/provider/test",
          { version: provider.version },
          "POST",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      try {
        onUpdated(await request<Status>("/assistant"));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      onUpdated(
        await request<Status>(
          "/assistant/provider",
          { version: provider.version },
          "DELETE",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-connection" aria-label="Model connection">
      <div className="model-connection-heading">
        <Plug size={20} />
        <div>
          <strong>{provider.model || "Connect a model"}</strong>
          <small>
            {provider.base_url
              ? status.model_connected
                ? "Connection tested"
                : "Saved · not tested"
              : "OpenAI-compatible endpoint"}
          </small>
        </div>
        <button
          type="button"
          className="tonal"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          {provider.base_url ? "Edit connection" : "Set up"}
        </button>
      </div>
      {provider.base_url && (
        <>
          <div className="model-connection-actions">
            <button
              type="button"
              className="text-button"
              disabled={busy || status.settings.mode === "manual"}
              onClick={() => void test()}
            >
              {busy ? (
                <LoaderCircle className="task-spinner" size={16} />
              ) : (
                <Check size={16} />
              )}
              Test connection
            </button>
            <button
              type="button"
              className="icon-button danger"
              aria-label="Remove model connection"
              title="Remove model connection"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <p className="helper">
            {status.settings.mode === "manual"
              ? "Turn on the assistant and save preferences to test this connection."
              : "Test sends a short message to the saved model."}
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <ConnectionEditor
          provider={provider}
          onClose={() => setOpen(false)}
          onSaved={(saved) => {
            onUpdated({ ...status, provider: saved, model_connected: false });
            setOpen(false);
            setError("");
          }}
        />
      )}
    </section>
  );
}
function ConnectionEditor({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: (provider: Provider) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [baseURL, setBaseURL] = useState(
      provider.base_url || "https://api.openai.com/v1",
    ),
    [model, setModel] = useState(provider.model),
    [protocol, setProtocol] = useState(provider.protocol);
  const [apiKey, setAPIKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  const backdrop = useBackdropDismiss(close, busy);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await request<Provider>("/assistant/provider", {
        base_url: baseURL,
        model,
        protocol,
        api_key: clearKey ? "" : apiKey || null,
        version: provider.version,
      });
      setAPIKey("");
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="model-editor"
      aria-labelledby="model-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      {...backdrop}
    >
      <div className="assistant-dialog-heading">
        <div>
          <p className="eyebrow">ASSISTANT</p>
          <h2 id="model-editor-title">Model connection</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close model connection"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <label className="field">
        <span>
          <Link size={14} />
          API base URL
        </span>
        <input
          type="url"
          aria-label="API base URL"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://api.openai.com/v1"
          disabled={busy}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Model ID</span>
        <input
          aria-label="Model ID"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Enter the model name from your provider"
          disabled={busy}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>
          <KeyRound size={14} />
          API key · optional for local servers
        </span>
        <input
          type="password"
          aria-label="Model API key"
          value={apiKey}
          onChange={(e) => {
            setAPIKey(e.target.value);
            setClearKey(false);
          }}
          placeholder={
            provider.has_api_key && !clearKey
              ? "Saved key · leave blank to keep"
              : "API key"
          }
          disabled={busy}
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>
      {provider.has_api_key && (
        <label className="model-clear-key">
          <input
            type="checkbox"
            checked={clearKey}
            disabled={busy}
            onChange={(e) => {
              setClearKey(e.target.checked);
              setAPIKey("");
            }}
          />
          Remove saved API key
        </label>
      )}
      <details>
        <summary>Advanced</summary>
        <label className="field">
          <span>API format</span>
          <FormSelect
            aria-label="API format"
            value={protocol}
            disabled={busy}
            onChange={(e) =>
              setProtocol(e.target.value as Provider["protocol"])
            }
          >
            <option value="chat_completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </FormSelect>
        </label>
        <p className="helper">
          Use the format supported by your provider and model. The URL is
          reached from Haven’s backend.
        </p>
      </details>
      <p className="helper">
        The API key stays on Haven’s backend. Chat sends your messages, active
        tasks when task planning is enabled, and any transactions you attach to
        this endpoint.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="assistant-preferences-footer">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !baseURL.trim() || !model.trim()}
          onClick={() => void save()}
        >
          {busy ? (
            <LoaderCircle size={18} className="task-spinner" />
          ) : (
            <Check size={18} />
          )}
          Save connection
        </button>
      </div>
    </dialog>
  );
}
