import { Lock, SkipForward, X } from "lucide-react";
import { builtInTags, lockedWhy, tagName } from "../lib/tasks";

// One chip for every place a task tag appears: your tags are neutral, built-in
// tags use the accent, a tag the task's type sets is outlined with a lock.
export default function TaskTag({
  tag,
  locked = false,
  dashed = false,
  onRemove,
}: {
  tag: string;
  locked?: boolean;
  dashed?: boolean;
  onRemove?: () => void;
}) {
  const special = builtInTags[tag];
  const name = tagName(tag);
  return (
    <span
      className="task-tag"
      data-special={special && !locked ? "" : undefined}
      data-locked={locked ? "" : undefined}
      data-dashed={dashed ? "" : undefined}
      title={locked ? lockedWhy : special?.description}
    >
      {locked ? (
        <Lock size={13} aria-hidden="true" />
      ) : special ? (
        <SkipForward size={12} aria-hidden="true" />
      ) : (
        <span className="task-tag-hash" aria-hidden="true">
          #
        </span>
      )}
      <span>{name}</span>
      {locked && <span className="sr-only">, locked: {lockedWhy}</span>}
      {onRemove && !locked && (
        <button
          type="button"
          className="task-tag-remove"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}
