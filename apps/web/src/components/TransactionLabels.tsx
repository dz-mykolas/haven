import Disclosure from "./Disclosure";
import TagChip from "./TagChip";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import FormSelect from "./FormSelect";
import { useId, useState, type ReactNode } from "react";
import { Tags, StickyNote } from "lucide-react";
import type { Category, Entry } from "../lib/api";

const categoryDescriptions: Record<string, string> = {
  Recurring:
    "Ongoing payments on a schedule, including bills and annual subscriptions.",
  Everyday:
    "Normal day-to-day spending, such as groceries, meals and transport.",
  Occasional:
    "Expenses outside your usual routine, such as a laptop, holiday or repair.",
};

export default function TransactionLabels({
  entry,
  categories,
  suggestions,
  onCategoryChange,
  children,
}: {
  entry: Entry;
  categories: Category[];
  suggestions: string[];
  onCategoryChange?: (id: string) => void;
  children?: ReactNode;
}) {
  const [tags, setTags] = useState(entry.tags ?? []);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(entry.notes ?? "");
  const [error, setError] = useState("");
  const [categoryID, setCategoryID] = useState(entry.category_id ?? "");
  const categoryHintID = useId();
  const categoryName = categories.find((c) => c.id === categoryID)?.name ?? "";
  const categoryHint = categoryDescriptions[categoryName];
  function add() {
    const clean = draft.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const existing = suggestions.find(
      (t) => t.toLowerCase() === clean.toLowerCase(),
    );
    if (tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    if (tags.length >= 12) {
      setError("Use up to 12 tags per transaction.");
      return;
    }
    setTags([...tags, existing ?? clean]);
    setDraft("");
    setError("");
  }
  return (
    <div className="transaction-labels">
      <label className="field">
        <span>Category</span>
        <FormSelect
          aria-label="Category"
          name="category_id"
          value={categoryID}
          onChange={(e) => {
            setCategoryID(e.target.value);
            onCategoryChange?.(e.target.value);
          }}
          aria-describedby={categoryHint ? categoryHintID : undefined}
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => !c.hidden || c.id === entry.category_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.hidden ? " (hidden)" : ""}
              </option>
            ))}
        </FormSelect>
        {categoryHint && (
          <span className="sr-only" id={categoryHintID}>
            {categoryHint}
          </span>
        )}
      </label>
      {children}
      <Disclosure
        className="annotation-details"
        title={
          <>
            <span className="sr-only">Tags & note</span>
            <span className="tag-summary">
              {tags.length ? (
                <>
                  {tags.slice(0, 2).map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                  {tags.length > 2 && (
                    <span className="tag-overflow">+{tags.length - 2}</span>
                  )}
                </>
              ) : (
                <span className="tag-empty">
                  <Tags size={16} aria-hidden="true" />
                  Add tags & note
                </span>
              )}
            </span>
            {note && (
              <span className="tag-note" title="Note added">
                <StickyNote size={16} aria-hidden="true" />
                <span className="sr-only">Note added</span>
              </span>
            )}
          </>
        }
      >
        <div className="field">
          <label htmlFor="transaction-tag-input">Tags</label>
          {tags.length > 0 && (
            <div className="tag-chips">
              {tags.map((tag) => (
                <span key={tag} className="tag-value">
                  <Input type="hidden" name="tags" value={tag} />
                  <TagChip
                    tag={tag}
                    onRemove={() => setTags(tags.filter((t) => t !== tag))}
                  />
                </span>
              ))}
            </div>
          )}
          <div className="tag-input">
            <Input
              id="transaction-tag-input"
              name="tag-draft"
              value={draft}
              maxLength={40}
              list="known-transaction-tags"
              placeholder="Add a tag…"
              onBlur={add}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
          <datalist id="known-transaction-tags">
            {suggestions
              .filter((t) => !tags.includes(t))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
          {error && (
            <span className="form-error" role="alert">
              {error}
            </span>
          )}
        </div>
        <label className="field">
          <span>Personal note</span>
          <Textarea
            name="notes"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={4000}
            rows={2}
            placeholder="Add a note…"
          />
        </label>
      </Disclosure>
    </div>
  );
}
