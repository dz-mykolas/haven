import { useId, type ReactNode } from "react";
import { ArrowUpRight, Check, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import type { AmountTone } from "../lib/api";

export default function AssistantDraftCard({
  icon: Icon,
  title,
  details,
  amount,
  amountTone = "neutral",
  label,
  saved = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  details: ReactNode;
  amount?: string;
  amountTone?: AmountTone;
  label: string;
  saved?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const description = useId();
  return (
    <Button
      type="button"
      variant="ghost"
      className="assistant-draft-card"
      aria-label={label}
      aria-describedby={description}
      disabled={disabled || saved}
      onClick={onClick}
    >
      <span className="draft-symbol">
        <Icon size={21} aria-hidden="true" />
      </span>
      <span className="assistant-draft-content">
        <span className="draft-kicker">{saved ? "Saved" : "Draft"}</span>
        <strong>{title}</strong>
        <span className="draft-facts" id={description}>
          {details}
        </span>
      </span>
      <span className="draft-trailing">
        {amount && <strong data-amount-tone={amountTone}>{amount}</strong>}
        <span className="draft-open">
          {saved ? <Check size={18} /> : <ArrowUpRight size={18} />}
        </span>
      </span>
    </Button>
  );
}
