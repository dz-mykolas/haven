import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./ui/tooltip";
import AssistantInbox, { type InboxController } from "./AssistantInbox";
import AssistantDraftCard from "./AssistantDraftCard";
import ModelConnection from "./ModelConnection";
import AssistantChat from "./AssistantChat";
import type { EditorState } from "./Editor";
import type { Snapshot } from "../lib/api";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  Hand,
  Inbox,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import { request } from "../lib/api";
import type { components } from "../lib/api.generated";
import { useBackdropDismiss } from "./useBackdropDismiss";

type Status = components["schemas"]["AssistantStatus"];
type Settings = components["schemas"]["AssistantSettings"];
type SkillID = keyof Settings["skills"];
const modes: {
  id: Settings["mode"];
  title: string;
  description: string;
  icon: typeof Hand;
}[] = [
  {
    id: "manual",
    title: "Manual only",
    description: "No model calls or AI suggestions.",
    icon: Hand,
  },
  {
    id: "on_request",
    title: "When I ask",
    description: "Help in chat when you ask. Changes from task notes wait for your approval.",
    icon: MessageCircle,
  },
  {
    id: "proactive",
    title: "Suggest too",
    description: "Also categorize transactions, suggest schedules and apply changes from task notes, with undo.",
    icon: Sparkles,
  },
];

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className={`assistant-toggle ${disabled ? "is-disabled" : ""}`}>
      <span>{children}</span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}

// Local display example only: it never calls a model or saves a task.
function FormPreview({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const backdrop = useBackdropDismiss(onClose, false);
  return (
    <dialog
      ref={dialog}
      className="assistant-preview-dialog"
      aria-labelledby="assistant-preview-title"
      onCancel={onClose}
      {...backdrop}
    >
      <div className="assistant-dialog-heading">
        <div>
          <p className="eyebrow">EXAMPLE</p>
          <h2 id="assistant-preview-title">Autofilled task</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close form preview"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="helper">
        A suggested draft would open in the task editor. This example is not
        saved.
      </p>
      <label className="field">
        <span>Task</span>
        <input readOnly value="Haircut" />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Day</span>
          <input readOnly value="Friday" />
        </label>
        <label className="field">
          <span>Time</span>
          <input readOnly value="16:30" />
        </label>
      </div>
      <button className="primary" onClick={onClose}>
        Done
      </button>
    </dialog>
  );
}

function Preferences({
  status,
  onClose,
  onSaved,
  onStatus,
}: {
  status: Status;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
  onStatus: (status: Status) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(status.settings);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  const backdrop = useBackdropDismiss(close, busy);
  const active = draft.mode !== "manual";
  async function save() {
    setBusy(true);
    setError("");
    try {
      const settings = await request<Settings>("/assistant/settings", draft);
      onSaved(settings);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const fresh = await request<Status>("/assistant");
      setDraft(fresh.settings);
      onStatus(fresh);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <dialog
        ref={dialog}
        className="assistant-preferences"
        aria-labelledby="assistant-preferences-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        {...backdrop}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="assistant-dialog-heading">
            <div>
              <p className="eyebrow">ASSISTANT</p>
              <h2 id="assistant-preferences-title">Your preferences</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close assistant preferences"
              disabled={busy}
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <ModelConnection status={status} onUpdated={onStatus} />
          <fieldset className="assistant-mode-options" disabled={busy}>
            <legend>How much help?</legend>
            {modes.map(({ id, title, description, icon: Icon }) => (
              <label
                key={id}
                className={`assistant-mode-option ${draft.mode === id ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="assistant-mode"
                  value={id}
                  checked={draft.mode === id}
                  onChange={() => setDraft({ ...draft, mode: id })}
                />
                <Icon size={21} />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <span className="assistant-mode-check" aria-hidden="true">
                  {draft.mode === id && <Check size={16} />}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="helper assistant-mode-note">
            {active
              ? draft.mode === "proactive"
                ? "Categories and tags apply automatically and can be undone in History. Recurring schedules need your approval."
                : "Chat suggestions stay as drafts until you save them."
              : "Money and Tasks work normally. Your other preferences are kept."}
          </p>
          <details className="assistant-options" open={undefined}>
            <summary>
              <SlidersHorizontal size={17} />
              Skills & details
            </summary>
            <div className="assistant-skills">
              {status.skills.map((skill) => {
                const id = skill.id as SkillID;
                const Icon =
                  id === "plan-task"
                    ? CalendarDays
                    : id === "organize-money"
                      ? Tags
                      : id === "follow-up"
                        ? Sparkles
                        : Wallet;
                return (
                  <Toggle
                    key={id}
                    label={skill.name}
                    checked={draft.skills[id]}
                    disabled={!active || busy}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        skills: { ...draft.skills, [id]: !draft.skills[id] },
                      })
                    }
                  >
                    <span className="assistant-skill-name">
                      <Icon size={19} />
                      <strong>{skill.name}</strong>
                    </span>
                    <small>{skill.description}</small>
                    {skill.supports_background &&
                      draft.mode === "proactive" && (
                        <small className="assistant-skill-trigger">
                          Existing and new transactions · schedules go to Inbox
                        </small>
                      )}
                  </Toggle>
                );
              })}
            </div>
            <Toggle
              label="Offer estimated costs"
              checked={draft.offer_estimated_costs}
              disabled={!active || !draft.skills["plan-task"] || busy}
              onChange={() =>
                setDraft({
                  ...draft,
                  offer_estimated_costs: !draft.offer_estimated_costs,
                })
              }
            >
              <strong>Offer estimated costs</strong>
              <small>
                Ask about an optional cost when planning appointments.
              </small>
            </Toggle>
          </details>
          <section
            className="assistant-presentation"
            aria-label="Draft appearance"
          >
            <h3>Drafts in chat</h3>
            <div
              className="assistant-draft-example"
              aria-label="Example draft appearance"
            >
              <span className="eyebrow">EXAMPLE</span>
              <AssistantDraftCard
                icon={CalendarDays}
                title="Haircut"
                details="Friday · 16:30"
                label="Review Haircut example"
                disabled={busy}
                onClick={() => setPreview(true)}
              />
            </div>
            <p className="helper">Click a draft to review and save it.</p>
          </section>
          {!status.model_connected && (
            <p className="assistant-setup-note">
              <CircleAlert size={16} />
              {status.provider.base_url
                ? "Connection saved. You can test it after turning on the assistant."
                : "Add a model connection above to use your skills."}
            </p>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload preferences
              </button>
            </div>
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
            <button className="primary" disabled={busy}>
              <Check size={18} />
              {busy ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      </dialog>
      {preview && <FormPreview onClose={() => setPreview(false)} />}
    </>
  );
}

export default function Assistant({
  onNavigate,
  data,
  onEdit,
  inbox,
  tab,
  onTab,
  onRefresh,
}: {
  inbox: InboxController;
  tab: "chat" | "inbox";
  onTab: (tab: "chat" | "inbox") => void;
  onNavigate: (page: "money" | "tasks") => void;
  data: Snapshot | null;
  onEdit: (editor: EditorState) => void;
  onRefresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    request<Status>("/assistant")
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function reload() {
    try {
      setStatus(await request<Status>("/assistant"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const mode = modes.find((mode) => mode.id === status?.settings.mode);
  return (
    <section
      className={`assistant-home ${status?.provider.base_url && status.settings.mode !== "manual" ? "has-chat" : ""}`}
      data-motion-block
    >
      <div className="assistant-workspace-heading">
        <span className="title-mark" aria-hidden="true">
          <Sparkles size={22} />
        </span>
        <h1>Assistant</h1>
        {status && (
          <div className="assistant-controls">
            <span className="assistant-mode-badge">
              <span className="status-dot" />
              {mode?.title}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label="Assistant preferences"
                    onClick={() => setOpen(true)}
                  >
                    <SlidersHorizontal size={19} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preferences</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {status &&
        (status.settings.mode === "manual" || !status.provider.base_url) && (
          <p className="assistant-off-note">
            {status.settings.mode === "manual"
              ? "Assistant is off. Your saved reviews are still here."
              : "Connect a model in Preferences to get started."}
          </p>
        )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => void reload()}>
            Retry preferences
          </button>
        </div>
      )}
      {notice && (
        <p className="assistant-saved" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      <div className="segments assistant-tabs" aria-label="Assistant view">
        <button aria-pressed={tab === "chat"} onClick={() => onTab("chat")}>
          <MessageCircle size={16} />
          Chat
        </button>
        <button aria-pressed={tab === "inbox"} onClick={() => onTab("inbox")}>
          <Inbox size={16} />
          Inbox
          {inbox.count ? (
            <span className="tab-count">{inbox.count}</span>
          ) : null}
        </button>
      </div>
      <div className="assistant-pane" hidden={tab !== "chat"}>
        {status &&
          status.settings.mode !== "manual" &&
          status.provider.base_url && (
            <AssistantChat status={status} data={data} onEdit={onEdit} />
          )}
      </div>
      {tab === "inbox" && (
        <AssistantInbox
          inbox={inbox}
          onEdit={onEdit}
          onRefresh={onRefresh}
          accounts={data?.accounts ?? []}
        />
      )}
      {status?.settings.mode === "manual" && (
        <div className="assistant-links">
          <button className="tonal" onClick={() => onNavigate("money")}>
            <Wallet />
            Open Money
            <ArrowRight size={18} />
          </button>
          <button className="tonal" onClick={() => onNavigate("tasks")}>
            <CheckCheck />
            Open Tasks
            <ArrowRight size={18} />
          </button>
        </div>
      )}
      {open && status && (
        <Preferences
          status={status}
          onStatus={setStatus}
          onClose={() => setOpen(false)}
          onSaved={(settings) => {
            setStatus({ ...status, settings });
            setNotice("Preferences saved");
            void inbox.refresh();
          }}
        />
      )}
    </section>
  );
}
