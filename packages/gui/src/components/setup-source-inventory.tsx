import type {
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
  KilnSkillCatalogSummarySnapshot,
} from "@kilnai/gateway-contracts";
import { Clipboard, Eye, FileCode2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SetupSourceInventoryProps {
  readonly snapshot: KilnConfigSetupSnapshot;
  readonly onPreviewSource: (path: string) => void;
}

const STATUS_TONE: Record<KilnConfigSourceStatus | KilnProjectionTargetStatus, "secondary" | "destructive" | "outline"> = {
  current: "outline",
  valid: "outline",
  managed: "outline",
  missing: "secondary",
  stale: "secondary",
  unmanaged: "secondary",
  invalid: "destructive",
  drifted: "destructive",
};

const PROJECTION_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function SetupSourceInventory(props: SetupSourceInventoryProps) {
  return (
    <section aria-label="Configuration Details" className="flex flex-col gap-6">
      <CanonicalSourcesCard snapshot={props.snapshot} onPreviewSource={props.onPreviewSource} />
      <GlobalInstructionShimsCard projections={props.snapshot.globalInstructionShims} />
      <NativeProjectionsCard projections={props.snapshot.nativeProjections} />
      <SkillCatalogCard skills={props.snapshot.skills} />
    </section>
  );
}

function SkillCatalogCard(props: { readonly skills: KilnSkillCatalogSummarySnapshot | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h3>Skill Catalog</h3></CardTitle>
        <CardDescription>
          Bounded inventory evidence for implicit skill metadata visible to each supported harness.
        </CardDescription>
        {props.skills ? (
          <CardAction>
            <Badge variant={props.skills.complete ? "outline" : "secondary"}>
              {props.skills.complete ? "Complete inventory" : "Incomplete inventory"}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {props.skills === undefined ? (
          <p role="status" aria-label="Skill catalog status" className="px-4 py-5 text-sm text-muted-foreground">Skill diagnostics are unavailable from this setup snapshot.</p>
        ) : (
          <>
            <dl aria-label="Skill identity summary" role="group" className="grid grid-cols-1 gap-px border-y border-border/70 bg-border/70 sm:grid-cols-3">
              <SkillIdentityMetric value={props.skills.equivalentDuplicates} label="Equivalent duplicate" />
              <SkillIdentityMetric value={props.skills.divergentCollisions} label="Divergent collision" />
              <SkillIdentityMetric value={props.skills.caseCollisions} label="Case collision" />
            </dl>
            <p className="border-b border-border/70 px-4 py-3 text-sm text-muted-foreground">
              Package health: {NUMBER_FORMATTER.format(props.skills.healthyPackages)} healthy, {NUMBER_FORMATTER.format(props.skills.warningPackages)} warning, {NUMBER_FORMATTER.format(props.skills.blockedPackages)} blocked.
            </p>
            {props.skills.harnesses.length === 0 ? (
              <p role="status" aria-label="Per-harness skill catalog status" className="px-4 py-5 text-sm text-muted-foreground">No per-harness skill catalog evidence is available.</p>
            ) : (
              <Table aria-label="Per-harness implicit skill catalog">
                <TableHeader>
                  <TableRow>
                    <TableHead>Harness</TableHead>
                    <TableHead className="text-right">Implicit skills</TableHead>
                    <TableHead className="text-right">Description bytes</TableHead>
                    <TableHead>Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {props.skills.harnesses.map((harness) => (
                    <TableRow key={harness.harness}>
                      <TableCell className="font-medium text-foreground">{skillHarnessLabel(harness.harness)}</TableCell>
                      <TableCell className="text-right tabular-nums">{NUMBER_FORMATTER.format(harness.candidateCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{NUMBER_FORMATTER.format(harness.descriptionBytes)} B</TableCell>
                      <TableCell className="min-w-52 whitespace-normal">
                        <Badge variant="secondary">{harness.budget.status === "known" ? "Known" : "Unknown"}</Badge>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{harness.budget.reason}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {(props.skills.externalExposure ?? []).filter((entry) => entry.status !== "not-configured").map((entry) => (
              <p key={entry.harness} className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
                External {skillHarnessLabel(entry.harness)}: {entry.status}; {NUMBER_FORMATTER.format(entry.realizedImplicit)} implicit, {NUMBER_FORMATTER.format(entry.suppressed)} suppressed; freshness {entry.freshness}.
              </p>
            ))}
            {props.skills.issues.length > 0 ? (
              <Table aria-label="Actionable skill catalog issues">
                <TableHeader>
                  <TableRow>
                    <TableHead>Skill</TableHead>
                    <TableHead>Harness</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Projection</TableHead>
                    <TableHead className="text-right">Path</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {props.skills.issues.map((issue) => (
                    <TableRow key={`${issue.skillName}:${issue.harness}:${issue.kind}:${issue.path}`}>
                      <TableCell className="font-medium text-foreground">{issue.skillName}</TableCell>
                      <TableCell>{skillHarnessLabel(issue.harness)}</TableCell>
                      <TableCell><Badge variant={issue.kind === "drifted" ? "destructive" : "secondary"}>{issue.kind}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{issue.projectionState}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy path for ${issue.skillName} ${skillHarnessLabel(issue.harness)} skill issue`} onClick={() => void copyText(issue.path)}>
                          <Clipboard aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
            {props.skills.omittedIssueCount > 0 ? (
              <p className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
                {NUMBER_FORMATTER.format(props.skills.omittedIssueCount)} more issues omitted from this bounded summary ({NUMBER_FORMATTER.format(props.skills.issueCount)} total). Open the detailed skills view for the complete catalog.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const NUMBER_FORMATTER = new Intl.NumberFormat();

function SkillIdentityMetric(props: { readonly value: number; readonly label: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}{props.value === 1 ? "" : "s"}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{NUMBER_FORMATTER.format(props.value)}</dd>
    </div>
  );
}

function skillHarnessLabel(harness: "claude" | "codex" | "opencode"): string {
  return harness === "claude" ? "Claude Code" : harness === "codex" ? "Codex" : "OpenCode";
}

function GlobalInstructionShimsCard(props: { readonly projections: KilnConfigSetupSnapshot["globalInstructionShims"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h3>Global Instruction Shims</h3></CardTitle>
        <CardDescription>Managed global instruction entrypoints for each supported harness.</CardDescription>
        <CardAction><Badge variant="outline">{props.projections.length} targets</Badge></CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {props.projections.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">No global instruction shims are configured.</p>
        ) : (
          <Table aria-label="Global instruction shims">
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Harness</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead className="text-right">Path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.projections.map((projection) => (
                <TableRow key={projection.targetId}>
                  <TableCell className="font-medium text-foreground">{projection.targetId}</TableCell>
                  <TableCell>{projection.harness}</TableCell>
                  <TableCell><Badge variant={STATUS_TONE[projection.status]}>{projection.status}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{projection.recommendation}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy path for ${projection.targetId}`} onClick={() => void copyText(projection.path)}>
                      <Clipboard aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CanonicalSourcesCard(props: SetupSourceInventoryProps) {
  const rows = canonicalSourceRows(props.snapshot);
  return (
    <Card>
      <CardHeader>
        <CardTitle><h3>Canonical Sources</h3></CardTitle>
        <CardDescription>Inspect what Kiln treats as authority and what it generates for repository harnesses.</CardDescription>
        <CardAction><Badge variant="outline">{rows.length} files</Badge></CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <Table aria-label="Canonical configuration sources">
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="min-w-52 whitespace-normal">
                  <div className="flex min-w-0 items-start gap-2">
                    <FileCode2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{row.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.location}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal text-muted-foreground">{row.purpose}</TableCell>
                <TableCell><Badge variant={STATUS_TONE[row.status]}>{row.status}</Badge></TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Preview ${row.label}`}
                      disabled={row.status === "missing"}
                      onClick={() => props.onPreviewSource(row.path)}
                    >
                      <Eye data-icon="inline-start" aria-hidden="true" />
                      Preview
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy path for ${row.label}`} onClick={() => void copyText(row.path)}>
                      <Clipboard aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NativeProjectionsCard(props: { readonly projections: KilnConfigSetupSnapshot["nativeProjections"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h3>Native Harness Projections</h3></CardTitle>
        <CardDescription>Managed agent and skill files installed outside the repository for each supported harness.</CardDescription>
        <CardAction><Badge variant="outline">{props.projections.length} targets</Badge></CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {props.projections.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">No native projections are installed.</p>
        ) : (
          <Table aria-label="Native harness projections">
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Harness</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.projections.map((projection) => {
                const target = nativeProjectionLabel(projection.targetId);
                const metadata = nativeProjectionMetadata(projection);
                return (
                  <TableRow key={projection.targetId} className="[contain-intrinsic-size:auto_44px] [content-visibility:auto]">
                    <TableCell className="max-w-sm whitespace-normal">
                      <p className="font-medium text-foreground">{target.name}</p>
                      {metadata ? <p className="mt-0.5 text-xs text-muted-foreground">{metadata}</p> : null}
                    </TableCell>
                    <TableCell>{target.harness}</TableCell>
                    <TableCell className="text-muted-foreground">{target.kind}</TableCell>
                    <TableCell><Badge variant={STATUS_TONE[projection.status]}>{projection.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy path for ${target.name}`} onClick={() => void copyText(projection.path)}>
                        <Clipboard aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function canonicalSourceRows(snapshot: KilnConfigSetupSnapshot) {
  return [
    {
      id: "project-context",
      label: "Project Context",
      location: ".kiln/project-context.md",
      purpose: "Durable repository guidance inherited by every harness.",
      path: snapshot.projectContext.path,
      status: snapshot.projectContext.status,
    },
    ...snapshot.repoShims.map((shim) => ({
      id: shim.targetId,
      label: shim.target === "agents" ? "AGENTS.md" : "CLAUDE.md",
      location: "Repository root",
      purpose: shim.target === "agents"
        ? "Generated instructions for Codex CLI and OpenCode."
        : "Generated instructions for Claude Code.",
      path: shim.path,
      status: shim.status,
    })),
  ];
}

function nativeProjectionLabel(targetId: string): { readonly harness: string; readonly kind: string; readonly name: string } {
  const [prefix = "native", ...nameParts] = targetId.split(":");
  const [harnessId = prefix, kindId = "projection"] = prefix.split("-");
  const harness = harnessId === "claude" ? "Claude Code" : harnessId === "codex" ? "Codex" : harnessId === "opencode" ? "OpenCode" : harnessId;
  const kind = kindId === "agent" ? "Agent" : kindId === "skill" ? "Skill" : kindId === "config" ? "Config" : "Projection";
  return { harness, kind, name: nameParts.join(":") || targetId };
}

function nativeProjectionMetadata(projection: KilnConfigSetupSnapshot["nativeProjections"][number]): string | null {
  const parts: string[] = [];
  if (projection.managedFieldCount !== undefined) {
    parts.push(`${projection.managedFieldCount} managed field${projection.managedFieldCount === 1 ? "" : "s"}`);
  }
  if (projection.updatedAt) {
    parts.push(`Updated ${PROJECTION_UPDATED_AT_FORMATTER.format(new Date(projection.updatedAt))}`);
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return projection.details ?? null;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text);
}
