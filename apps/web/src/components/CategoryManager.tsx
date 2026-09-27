import { useState } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, X } from "lucide-react";
import { request, type Category } from "../lib/api";

export default function CategoryManager({
  categories,
  onSaved,
}: {
  categories: Category[];
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(category: Category) {
    setBusy(true);
    setError("");
    try {
      await request(`/categories/${category.id}`, category);
      setEditing(null);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="category-manager">
      <summary>Categories</summary>
      <p className="helper">Hidden categories stay on existing transactions.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="category-manager-list">
        {categories.map((c) => (
          <div key={c.id} className="category-manager-row">
            <span className={c.hidden ? "muted" : ""}>
              {c.name}
              {c.hidden && <small>Hidden</small>}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Rename ${c.name}`}
              title="Rename"
              disabled={busy}
              onClick={() => {
                setEditing(c);
                setName(c.name);
                setError("");
              }}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${c.hidden ? "Show" : "Hide"} category ${c.name}`}
              title={c.hidden ? "Show" : "Hide"}
              disabled={busy}
              onClick={() => void save({ ...c, hidden: !c.hidden })}
            >
              {c.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>
        ))}
      </div>
      {editing ? (
        <form
          className="category-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ ...editing, name });
          }}
        >
          <label className="field">
            <span>
              {editing.version ? "Category name" : "New category name"}
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              disabled={busy}
            />
          </label>
          <button
            className="icon-button tonal"
            aria-label="Save category"
            title="Save category"
            disabled={busy}
          >
            <Check size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel category edit"
            title="Cancel"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            <X size={18} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setEditing({
              id: crypto.randomUUID(),
              name: "",
              hidden: false,
              version: 0,
            });
            setName("");
            setError("");
          }}
        >
          <Plus size={17} />
          New category
        </button>
      )}
    </details>
  );
}
