import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { InputGroupButton } from "@/components/ui/input-group";

const DEFAULT_WORK_ITEM_COUNT = 3;

export function GovernedTaskControl(props: {
  readonly workItemCount: number | null;
  readonly disabled?: boolean;
  readonly onChange: (workItemCount: number | null) => void;
}) {
  const active = props.workItemCount !== null;
  const displayedCount = props.workItemCount ?? DEFAULT_WORK_ITEM_COUNT;

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <InputGroupButton
            type="button"
            size={active ? "sm" : "icon-sm"}
            variant={active ? "secondary" : "outline"}
            disabled={props.disabled}
            aria-label={active
              ? `Governed task enabled with ${displayedCount} work items`
              : "Configure governed task"}
            aria-pressed={active}
            className={active ? "tabular-nums" : "bg-background/60 text-muted-foreground"}
          >
            <ListTodo aria-hidden="true" />
            {active ? <span>Goal {displayedCount}</span> : null}
          </InputGroupButton>
        )}
      />
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Governed task</PopoverTitle>
          <PopoverDescription>
            Require Kiln to create the work items and linked goal before it can inspect or execute.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="governed-work-item-count">Required work items</Label>
          <Input
            id="governed-work-item-count"
            type="number"
            min={1}
            step={1}
            value={displayedCount}
            disabled={!active}
            aria-describedby="governed-work-item-count-help"
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isSafeInteger(value) && value > 0) {
                props.onChange(value);
              }
            }}
          />
          <p id="governed-work-item-count-help" className="text-xs leading-5 text-muted-foreground">
            The runtime enforces this count from canonical tool evidence, not assistant text.
          </p>
        </div>
        <Button
          type="button"
          variant={active ? "outline" : "default"}
          className="w-full"
          onClick={() => props.onChange(active ? null : DEFAULT_WORK_ITEM_COUNT)}
        >
          {active ? "Remove requirement" : "Require goal first"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
