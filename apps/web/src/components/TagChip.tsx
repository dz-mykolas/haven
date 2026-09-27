import {
  House,
  ShoppingBasket,
  Utensils,
  Car,
  Plane,
  BriefcaseBusiness,
  Dumbbell,
  HeartPulse,
  Clapperboard,
  GraduationCap,
  Gift,
  PawPrint,
  ShoppingBag,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "./ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

const appearances: Record<string, [LucideIcon, string]> = {
  home: [House, "blue"],
  groceries: [ShoppingBasket, "green"],
  food: [Utensils, "amber"],
  dining: [Utensils, "amber"],
  transport: [Car, "blue"],
  travel: [Plane, "teal"],
  work: [BriefcaseBusiness, "blue"],
  fitness: [Dumbbell, "teal"],
  health: [HeartPulse, "rose"],
  entertainment: [Clapperboard, "violet"],
  education: [GraduationCap, "violet"],
  gifts: [Gift, "rose"],
  pets: [PawPrint, "amber"],
  shopping: [ShoppingBag, "rose"],
  family: [Users, "green"],
};
const tones = ["blue", "green", "amber", "teal", "rose", "violet"];

// A tag keeps its color across drafts, edits and reloads without storing styling.
export default function TagChip({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove?: () => void;
}) {
  const key = tag.trim().toLowerCase();
  const known = appearances[key];
  const hash = Array.from(key).reduce(
    (value, letter) => (value * 31 + letter.codePointAt(0)!) >>> 0,
    0,
  );
  const Icon = known?.[0];
  const chip = (
    <Badge
      variant="secondary"
      className="purpose-tag"
      data-tone={known?.[1] ?? tones[hash % tones.length]}
      data-preview={!onRemove}
    >
      <span className="purpose-tag-icon" aria-hidden="true">
        {Icon ? <Icon size={14} /> : Array.from(tag.trim())[0]?.toUpperCase()}
      </span>
      <span className="purpose-tag-name">{tag}</span>
      {onRemove && (
        <button
          type="button"
          className="purpose-tag-remove"
          aria-label={`Remove tag ${tag}`}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </Badge>
  );
  return onRemove ? (
    chip
  ) : (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="tag-tooltip" sideOffset={5}>
          {tag}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
