import {
  Children,
  isValidElement,
  useId,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

// Form adapter around the installed shadcn Select. Keeps existing form names and values.
export default function FormSelect({
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  className,
  id,
  ...props
}: ComponentProps<"select">) {
  const generatedID = useId();
  const [local, setLocal] = useState(String(defaultValue ?? ""));
  const current = value === undefined ? local : String(value);
  const options = Children.toArray(children).filter(
    isValidElement<{
      value?: string;
      disabled?: boolean;
      children?: React.ReactNode;
    }>,
  );
  return (
    <>
      <input type="hidden" name={name} value={current} disabled={disabled} />
      <Select
        disabled={disabled}
        required={required}
        value={current || "__empty__"}
        onValueChange={(next) => {
          const clean = next === "__empty__" ? "" : next;
          setLocal(clean);
          onChange?.({
            target: { value: clean },
            currentTarget: { value: clean },
          } as ChangeEvent<HTMLSelectElement>);
        }}
      >
        <SelectTrigger
          id={id ?? generatedID}
          className={`form-select ${className ?? ""}`}
          aria-label={props["aria-label"]}
          aria-describedby={props["aria-describedby"]}
          aria-invalid={props["aria-invalid"]}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          sideOffset={-14}
          avoidCollisions={false}
          collisionPadding={8}
        >
          {options.map((option) => (
            <SelectItem
              data-value={String(option.props.value ?? "") || "__empty__"}
              key={String(option.props.value ?? "")}
              value={String(option.props.value ?? "") || "__empty__"}
              disabled={option.props.disabled}
            >
              {option.props.children}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
