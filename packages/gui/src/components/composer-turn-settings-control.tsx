import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
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

export function ComposerTurnSettingsControl(props: {
  readonly planMode: boolean;
  readonly governedWorkItemCount: number | null;
  readonly deliberationControl?: ReactNode;
  readonly onPlanModeChange: (enabled: boolean) => void;
  readonly onGovernedWorkItemCountChange: (count: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const mode: ComposerWorkMode = props.planMode ? "plan" : "build";
  const governedSetupActive = props.governedWorkItemCount !== null;
  const displayedCount = props.governedWorkItemCount ?? DEFAULT_WORK_ITEM_COUNT;
  const visibleState = props.planMode ? "Plan" : governedSetupActive ? `Goal ${displayedCount}` : null;
  const accessibleLabel = governedSetupActive
    ? `Turn settings: Build; governed goal with ${displayedCount} work items`
    : `Turn settings: ${props.planMode ? "Plan" : "Build"}`;

  function selectMode(values: readonly unknown[]): void {
    const selectedMode = values.at(-1);
    if (selectedMode !== "build" && selectedMode !== "plan") return;
    if (selectedMode === mode) return;
    props.onPlanModeChange(selectedMode === "plan");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={accessibleLabel}
        render={(
          <InputGroupButton
            type="button"
            size={visibleState ? "sm" : "icon-sm"}
            variant={mode === "plan" || governedSetupActive ? "secondary" : "ghost"}
            className="h-8 shrink-0"
          >
            <Settings2 data-icon="inline-start" aria-hidden="true" />
            {visibleState}
          </InputGroupButton>
        )}
      />
      <PopoverContent align="start" side="top" sideOffset={8} className="w-80 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Turn settings</PopoverTitle>
          <PopoverDescription>Choose how Kiln prepares and executes this turn.</PopoverDescription>
        </PopoverHeader>
        <ToggleGroup
          aria-label="Work mode options"
          value={[mode]}
          onValueChange={selectMode}
          variant="outline"
          spacing={0}
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="build" aria-label="Build" className="w-full">Build</ToggleGroupItem>
          <ToggleGroupItem value="plan" aria-label="Plan for approval" className="w-full">Plan</ToggleGroupItem>
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
        {props.deliberationControl ? (
          <>
            <Separator />
            <div className="grid gap-2">
              <p className="text-xs font-medium text-foreground">Deliberation</p>
              {props.deliberationControl}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
