import { useEffect, useState } from "react";
import type {
  KilnConfigurationOnboardingApplyRequest,
  KilnConfigurationOnboardingSnapshot,
} from "@kilnai/gateway-contracts";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ConfigurationOnboardingPanelProps {
  readonly snapshot: KilnConfigurationOnboardingSnapshot | null | undefined;
  readonly loading: boolean;
  readonly applying: boolean;
  readonly error: Error | null;
  readonly feedback?: string | null;
  readonly onRefresh: () => void;
  readonly onApply: (request: KilnConfigurationOnboardingApplyRequest) => void;
}

export function ConfigurationOnboardingPanel(props: ConfigurationOnboardingPanelProps) {
  const initialTargetId = selectedTargetId(props.snapshot);
  const [targetId, setTargetId] = useState(initialTargetId);

  useEffect(() => {
    setTargetId(selectedTargetId(props.snapshot));
  }, [props.snapshot]);

  const resetDraft = () => {
    setTargetId(selectedTargetId(props.snapshot));
  };

  if (props.loading) {
    return <Skeleton className="h-64 rounded-md" aria-label="Loading first-run setup" />;
  }
  if (props.error) {
    return (
      <Card role="alert" className="border-destructive/40">
        <CardHeader>
          <CardTitle><h3>First-run status unavailable</h3></CardTitle>
          <CardDescription>{props.error.message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={props.onRefresh}>Retry</Button>
        </CardFooter>
      </Card>
    );
  }
  if (!props.snapshot) {
    return null;
  }
  if (props.snapshot.status === "complete") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            <div>
              <CardTitle><h3>First turn ready</h3></CardTitle>
              <CardDescription className="mt-1">
                {props.snapshot.nextAction ?? "This project already uses the canonical safe setup."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }
  if (props.snapshot.status === "blocked") {
    return (
      <Card className="border-[var(--color-warning)]/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <div>
              <CardTitle><h3>Provider setup required</h3></CardTitle>
              <CardDescription className="mt-1">
                Kiln will not invent target, data-policy, or usage evidence during project onboarding.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-foreground">
          {props.snapshot.blockers.map((blocker) => <p key={blocker.code}>{blocker.message}</p>)}
          {props.snapshot.nextAction ? <p className="text-muted-foreground">{props.snapshot.nextAction}</p> : null}
        </CardContent>
        <CardFooter>
          <Button type="button" variant="outline" onClick={props.onRefresh}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            Refresh
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            <div>
              <CardTitle><h3>Set up the first safe turn</h3></CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Adopt this project with an admitted target and an explicit restrictive permission posture. No credentials or machine paths enter project configuration.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">Project scope</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form
          id="configuration-onboarding-form"
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            props.onApply({ schemaVersion: 1, scope: "project", posture: "read-only", targetId: targetId || null });
          }}
        >
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Default execution target
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={targetId}
              disabled={props.applying}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {props.snapshot.targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} — {target.providerId}/{target.providerModelId}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 rounded-md border border-border/70 p-3 text-sm">
            <span className="font-medium text-foreground">Permission posture</span>
            <span><strong>Read only</strong><span className="mt-1 block text-muted-foreground">The first planning turn cannot modify the workspace. Broader posture is configured later through the governed settings owner.</span></span>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">{props.feedback ?? props.snapshot.nextAction}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={props.applying} onClick={resetDraft}>Cancel</Button>
          <Button type="submit" form="configuration-onboarding-form" disabled={props.applying || !targetId}>
            {props.applying ? <RefreshCw data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
            Adopt safe setup
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function selectedTargetId(snapshot: KilnConfigurationOnboardingSnapshot | null | undefined): string {
  return snapshot?.targets.find((target) => target.selected)?.id
    ?? snapshot?.defaultTargetId
    ?? snapshot?.targets[0]?.id
    ?? "";
}
