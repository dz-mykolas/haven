import { useState, type ReactNode } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";

// Keep form values mounted when a disclosure closes.
export default function Disclosure({
  title,
  children,
  className = "",
  open: controlledOpen,
  onOpenChange,
  label,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  return (
    <Accordion
      type="single"
      collapsible
      value={open ? "details" : ""}
      onValueChange={(value) => {
        setLocalOpen(!!value);
        onOpenChange?.(!!value);
      }}
      className={`form-disclosure ${className}`}
    >
      <AccordionItem value="details">
        <AccordionTrigger aria-label={label}>{title}</AccordionTrigger>
        <AccordionContent forceMount inert={!open}>
          <div className="form-disclosure-clip">
            <div className="form-disclosure-body">{children}</div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
