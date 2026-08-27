import type {
  ToolResultFormalVerificationPresentation,
  ToolResultInferentialVerificationPresentation,
  ToolResultQualityVerificationPresentation,
  ToolResultStaticVerificationPresentation,
  ToolResultVerificationPresentation,
} from "@kilnai/gateway-contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VerificationEngineMark, verificationEngineLabel } from "./verification-engine-mark.js";

export interface VerificationEvidenceProps {
  readonly verification: ToolResultVerificationPresentation;
}

export function VerificationEvidence({ verification }: VerificationEvidenceProps) {
  return (
    <section aria-label="Verification evidence" className="flex flex-col gap-3">
      <VerificationIdentity verification={verification} />
      {verification.kind === "formal" ? <FormalEvidence verification={verification} /> : null}
      {verification.kind === "static" ? <StaticEvidence verification={verification} /> : null}
      {verification.kind === "quality" ? <QualityEvidence verification={verification} /> : null}
      {verification.kind === "inferential" ? <InferentialEvidence verification={verification} /> : null}
      <Alert>
        <AlertTitle>Assurance is a separate decision</AlertTitle>
        <AlertDescription>
          This tool reports candidate-bound evidence and establishes no acceptance criterion by itself.
        </AlertDescription>
      </Alert>
    </section>
  );
}

function VerificationIdentity({ verification }: VerificationEvidenceProps) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-2.5">
        <VerificationEngineMark engineName={verification.engine.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {verificationEngineLabel(verification.engine.name)} {verification.engine.version}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={verification.candidate.digest}>
            {compactDigest(verification.candidate.digest)}
          </p>
        </div>
      </div>
      <VerificationOutcomeBadge verification={verification} />
      <p className="min-w-0 text-xs text-muted-foreground sm:col-span-2">
        {verification.candidate.subjects.map((subject) => subject.path).join(", ")}
      </p>
    </div>
  );
}

function VerificationOutcomeBadge({ verification }: VerificationEvidenceProps) {
  if (verification.kind === "formal") {
    return <Badge variant={verification.outcome === "refuted" ? "destructive" : verification.outcome === "proved" ? "secondary" : "outline"}>{verification.outcome}</Badge>;
  }
  if (verification.kind === "static") {
    return <Badge variant={verification.outcome === "violations" ? "destructive" : "secondary"}>{verification.outcome}</Badge>;
  }
  if (verification.kind === "quality") {
    return <Badge variant={verification.outcome === "diagnostics" ? "destructive" : "secondary"}>{humanize(verification.outcome)}</Badge>;
  }
  return <Badge variant="outline">{humanize(verification.outcome.applicability)}</Badge>;
}

function FormalEvidence({ verification }: { readonly verification: ToolResultFormalVerificationPresentation }) {
  const progress = verification.totals.total === 0
    ? 0
    : Math.round((verification.totals.proved / verification.totals.total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <Progress value={progress} aria-label="Formal obligations proved">
        <ProgressLabel>{verification.totals.proved} of {verification.totals.total} obligations proved</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Table aria-label="Formal verification obligations">
        <TableHeader>
          <TableRow>
            <TableHead>Obligation</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="text-right">Effort</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {verification.checks.map((check) => (
            <TableRow key={check.label}>
              <TableCell className="max-w-64 whitespace-normal">
                <p className="font-mono text-xs font-medium text-foreground">{check.label}</p>
                {check.detail ? <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p> : null}
              </TableCell>
              <TableCell><Badge variant={check.outcome === "refuted" ? "destructive" : check.outcome === "proved" ? "secondary" : "outline"}>{check.outcome}</Badge></TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                <span>{check.resourceCount.toLocaleString("en-US")} RU</span>
                <span className="block">{check.durationMs.toLocaleString("en-US")} ms</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StaticEvidence({ verification }: { readonly verification: ToolResultStaticVerificationPresentation }) {
  const diagnosticLabel = `${verification.diagnostics.length} diagnostic${verification.diagnostics.length === 1 ? "" : "s"} across ${verification.profile.rulesAnalyzed} rules`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{diagnosticLabel}</p>
      <p className="font-mono text-xs text-muted-foreground">{verification.profile.id}</p>
      {verification.diagnostics.length > 0 ? (
        <Table aria-label="Static analysis diagnostics">
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Diagnostic</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {verification.diagnostics.map((diagnostic, index) => (
              <TableRow key={`${diagnostic.file}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.rule ?? index}`}>
                <TableCell><Badge variant={diagnostic.severity === "error" ? "destructive" : "outline"}>{diagnostic.rule ?? diagnostic.severity}</Badge></TableCell>
                <TableCell className="max-w-72 whitespace-normal text-muted-foreground">{diagnostic.message}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{diagnosticLocation(diagnostic)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}

function InferentialEvidence({ verification }: { readonly verification: ToolResultInferentialVerificationPresentation }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Applicability</dt>
      <dd className="text-foreground">{humanize(verification.outcome.applicability)}</dd>
      <dt className="text-muted-foreground">Action</dt>
      <dd className="font-mono text-xs text-foreground">{verification.outcome.action}</dd>
      <dt className="text-muted-foreground">Review state</dt>
      <dd className="font-mono text-xs text-foreground">{verification.transaction.state}</dd>
      <dt className="text-muted-foreground">Lineage</dt>
      <dd className="truncate font-mono text-xs text-foreground" title={verification.transaction.lineageId}>{verification.transaction.lineageId}</dd>
      <dt className="text-muted-foreground">Replayability</dt>
      <dd className="font-mono text-xs text-foreground">{verification.outcome.replayability}</dd>
      {verification.outcome.nextTransition ? (
        <>
          <dt className="text-muted-foreground">Next transition</dt>
          <dd className="font-mono text-xs text-foreground">{verification.outcome.nextTransition.kind} · {verification.outcome.nextTransition.reasonCode}</dd>
        </>
      ) : null}
    </dl>
  );
}

function QualityEvidence({ verification }: { readonly verification: ToolResultQualityVerificationPresentation }) {
  const diagnosticCount = verification.profiles.reduce((count, profile) => count + profile.diagnostics.length, 0);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          {diagnosticCount === 0 ? "No configured quality diagnostics" : `${diagnosticCount} configured quality diagnostic${diagnosticCount === 1 ? "" : "s"}`}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          parser {verification.engine.parser.name} {verification.engine.parser.version}
        </p>
      </div>
      {verification.profiles.map((profile) => (
        <section key={`${profile.name}/${profile.revision}`} aria-label={`${profile.name} quality profile`} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs font-medium text-foreground">{profile.name}/{profile.revision}</p>
            <Badge variant="outline">{profile.rules.length} rules</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{profile.rules.map((rule) => `${rule.name}/${rule.revision}`).join(", ")}</p>
          {profile.diagnostics.length > 0 ? (
            <Table aria-label={`${profile.name} diagnostics`}>
              <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Diagnostic</TableHead><TableHead>Location</TableHead></TableRow></TableHeader>
              <TableBody>{profile.diagnostics.map((diagnostic) => (
                <TableRow key={`${diagnostic.line}:${diagnostic.column}:${diagnostic.rule.name}`}>
                  <TableCell><Badge variant="outline">{diagnostic.rule.name}/{diagnostic.rule.revision}</Badge></TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-muted-foreground">{diagnostic.message}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{verification.candidate.subjects[0]?.path}:{diagnostic.line}:{diagnostic.column}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function compactDigest(value: string): string {
  return value.length > 28 ? `${value.slice(0, 19)}…${value.slice(-8)}` : value;
}

function humanize(value: string): string {
  return value.replace(/_/gu, " ");
}

function diagnosticLocation(diagnostic: ToolResultStaticVerificationPresentation["diagnostics"][number]): string {
  if (diagnostic.line === undefined) return diagnostic.file;
  return `${diagnostic.file}:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
}
