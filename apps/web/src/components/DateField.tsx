import { useState, type ComponentProps } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Calendar } from "./ui/calendar";

export default function DateField({
  defaultValue,
  value: controlledValue,
  onValueChange,
  ...props
}: ComponentProps<"input"> & { onValueChange?: (value: string) => void }) {
  const [internalValue, setValue] = useState(String(defaultValue ?? ""));
  const value =
    controlledValue === undefined ? internalValue : String(controlledValue);
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <div className="date-control">
      <Input
        {...props}
        type="date"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onValueChange?.(event.target.value);
          props.onChange?.(event);
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={`Open calendar for ${props.name ?? "date"}`}
          >
            <CalendarDays size={18} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="date-popover"
          align="end"
          aria-label="Choose date"
        >
          <Calendar
            mode="single"
            selected={date && !isNaN(date.getTime()) ? date : undefined}
            defaultMonth={date && !isNaN(date.getTime()) ? date : undefined}
            onSelect={(next) => {
              if (!next) return;
              const dateValue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
              setValue(dateValue);
              onValueChange?.(dateValue);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
