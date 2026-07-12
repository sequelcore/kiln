import type {
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
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
    <section aria-label="Setup Details" className="flex flex-col gap-6">
      <CanonicalSourcesCard snapshot={props.snapshot} onPreviewSource={props.onPreviewSource} />
      <GlobalInstructionShimsCard projections={props.snapshot.globalInstructionShims} />
      <NativeProjectionsCard projections={props.snapshot.nativeProjections} />
    </section>
  );
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
        <Table aria-label="Canonical setup sources">
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
