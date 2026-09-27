import { useState } from "react";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import FormSelect from "./FormSelect";
import DateField from "./DateField";
import Disclosure from "./Disclosure";
import type { Task } from "../lib/api";

type Plan = NonNullable<Task["plan"]>;
export const initialPlan: Plan = {
  kind: "scheduled",
  excluded: false,
  remind: false,
  expires_on: "",
  date_until: "",
  interval_days: 0,
  coverage_days: 0,
  coverage_through: "",
  quantity: 1,
};
export function readPlan(form: FormData, name = "plan"): Plan | undefined {
  const raw = form.get(name);
  return typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
}
export default function PaymentPlanFields({
  value,
  name = "plan",
  onKind,
}: {
  value?: Plan;
  name?: string;
  onKind?: (kind: Plan["kind"]) => void;
}) {
  const [plan, setPlan] = useState<Plan>(value ?? initialPlan);
  const change = (patch: Partial<Plan>) => setPlan({ ...plan, ...patch });
  return (
    <div className="payment-plan-fields">
      <input type="hidden" name={name} value={JSON.stringify(plan)} />
      <label className="field">
        <span>Plan type</span>
        <FormSelect
          aria-label="Plan type"
          value={plan.kind}
          onChange={(e) => {
            const kind = e.target.value as Plan["kind"];
            change({ kind, date_until: "" });
            onKind?.(kind);
          }}
        >
          <option value="scheduled">Scheduled payment</option>
          <option value="expected">Expected purchase</option>
          <option value="prepaid">Prepaid coverage</option>
        </FormSelect>
      </label>
      <Disclosure title={<span>Forecast & coverage</span>}>
        <label className="forecast-include">
          <span>Include in estimated spending</span>
          <Switch
            aria-label="Include in estimated spending"
            checked={!plan.excluded}
            onCheckedChange={(checked) => change({ excluded: !checked })}
          />
        </label>
        {plan.kind !== "scheduled" && (
          <>
            <label className="forecast-include">
              <span>Show reminder in Tasks</span>
              <Switch
                aria-label="Show reminder in Tasks"
                checked={plan.remind}
                onCheckedChange={(remind) => change({ remind })}
              />
            </label>
            <label className="field">
              <span>Usual purchase quantity</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={plan.quantity}
                onChange={(e) => change({ quantity: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {plan.kind === "expected" && (
          <>
            <label className="field">
              <span>Latest expected date · optional</span>
              <DateField
                aria-label="Latest expected date"
                type="date"
                defaultValue={plan.date_until}
                onValueChange={(date_until) => change({ date_until })}
              />
            </label>
            <label className="field">
              <span>Typical gap · days</span>
              <Input
                type="number"
                min={0}
                max={3660}
                value={plan.interval_days || ""}
                placeholder="Unknown"
                onChange={(e) =>
                  change({ interval_days: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
        {plan.kind === "prepaid" && (
          <>
            <label className="field">
              <span>Current coverage ends · optional</span>
              <DateField
                aria-label="Coverage ends"
                type="date"
                defaultValue={plan.expires_on}
                onValueChange={(expires_on) =>
                  change({
                    expires_on,
                    coverage_through: new Date().toLocaleDateString("en-CA"),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Includes purchases through</span>
              <DateField
                aria-label="Coverage baseline date"
                type="date"
                value={plan.coverage_through}
                onValueChange={(coverage_through) =>
                  change({ coverage_through })
                }
              />
            </label>
            <label className="field">
              <span>Days added per unit</span>
              <Input
                type="number"
                min={0}
                max={3660}
                value={plan.coverage_days || ""}
                placeholder="e.g. 30"
                onChange={(e) =>
                  change({ coverage_days: Number(e.target.value) })
                }
              />
            </label>
            <p className="helper">
              Use the coverage you have now, including this purchase. Leave it
              blank if unknown.
            </p>
          </>
        )}
      </Disclosure>
    </div>
  );
}
