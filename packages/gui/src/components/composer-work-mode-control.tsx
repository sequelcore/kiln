import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DEFAULT_WORK_ITEM_COUNT = 3;

type ComposerWorkMode = "build" | "plan";

export function ComposerWorkModeControl(props: {
  readonly planMode: boolean;
  readonly governedWorkItemCount: number | null;
  readonly onPlanModeChange: (enabled: boolean) => void;
  readonly onGovernedWorkItemCountChange: (count: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const mode: ComposerWorkMode = props.planMode ? "plan" : "build";
  const governedSetupActive = props.governedWorkItemCount !== null;
  const displayedCount = props.governedWorkItemCount ?? DEFAULT_WORK_ITEM_COUNT;
  const triggerLabel = props.planMode
    ? "Plan"
    : governedSetupActive
      ? `Build · Goal ${displayedCount}`
      : "Build";
  const accessibleLabel = governedSetupActive
    ? `Work mode: Build; governed goal with ${displayedCount} work items`
    : `Work mode: ${triggerLabel}`;

  function selectMode(values: readonly unknown[]): void {
    const selectedMode = values.at(-1);
    if (selectedMode !== "build" && selectedMode !== "plan") return;
    if (selectedMode === mode) return;

    if (selectedMode === "plan") {
      props.onPlanModeChange(true);
    } else {
      props.onPlanModeChange(false);
    }
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={accessibleLabel}
        render={(
          <InputGroupButton type="button" size="sm" variant={mode === "plan" || governedSetupActive ? "secondary" : "ghost"} className="h-8 shrink-0 has-data-[icon=inline-end]:pr-2.5">
            {triggerLabel}
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </InputGroupButton>
        )}
      />
      <PopoverContent align="start" side="top" sideOffset={8} className="w-80 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Work mode</PopoverTitle>
          <PopoverDescription>Choose whether Kiln can execute or must prepare a plan for approval.</PopoverDescription>
        </PopoverHeader>
        <ToggleGroup
          aria-label="Work mode options"
          value={[mode]}
          onValueChange={selectMode}
          variant="outline"
          spacing={0}
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="build" aria-label="Build" className="w-full">
            Build
          </ToggleGroupItem>
          <ToggleGroupItem value="plan" aria-label="Plan for approval" className="w-full">
            Plan
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "build" ? (
          <>
            <Separator />
            <Field data-disabled={!governedSetupActive}>
              <FieldLabel htmlFor="governed-work-item-count">Exact work items</FieldLabel>
              <Input
                id="governed-work-item-count"
                type="number"
                min={1}
                step={1}
                value={displayedCount}
                disabled={!governedSetupActive}
                aria-describedby="governed-work-item-count-help"
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isSafeInteger(value) && value > 0) {
                    props.onGovernedWorkItemCountChange(value);
                  }
                }}
              />
              <FieldDescription id="governed-work-item-count-help">
                Before inspection, create a goal linked to exactly this many work items.
              </FieldDescription>
            </Field>
            <Button
              type="button"
              variant={governedSetupActive ? "outline" : "default"}
              className="w-full"
              onClick={() => props.onGovernedWorkItemCountChange(
                governedSetupActive ? null : DEFAULT_WORK_ITEM_COUNT,
              )}
            >
              {governedSetupActive ? "Remove goal setup" : "Require goal setup"}
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
