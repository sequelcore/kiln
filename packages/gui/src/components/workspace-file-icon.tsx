import type { OperatorWorkspaceTreeEntry } from "@kilnai/gateway-contracts";
import { Folder } from "lucide-react";
import { FileIcon, defaultStyles, type FileIconGlyph, type FileIconProps } from "react-file-icon";
import { cn } from "@/lib/utils";

interface WorkspaceFileIconProps {
  readonly entry: OperatorWorkspaceTreeEntry;
}

const SPECIAL_FILE_STYLES: Record<string, FileIconProps> = {
  "package.json": { color: "#73c991", glyphColor: "#0d0f13", labelColor: "#246b3d", type: "settings" },
  "bun.lock": { color: "#e0b557", glyphColor: "#0d0f13", labelColor: "#73530f", type: "binary" },
  "bun.lockb": { color: "#e0b557", glyphColor: "#0d0f13", labelColor: "#73530f", type: "binary" },
  "readme.md": { color: "#76c7e8", glyphColor: "#0d0f13", labelColor: "#0b6785", type: "document" },
};

const EXTENSION_TYPE_OVERRIDES: Record<string, FileIconGlyph> = {
  cjs: "code",
  css: "code",
  cts: "code",
  html: "code",
  js: "code",
  json: "settings",
  jsonc: "settings",
  jsx: "code",
  lock: "binary",
  md: "document",
  mdx: "document",
  mts: "code",
  png: "image",
  ps1: "code",
  sh: "code",
  sql: "code",
  svg: "vector",
  toml: "settings",
  ts: "code",
  tsx: "code",
  txt: "document",
  xml: "code",
  yaml: "settings",
  yml: "settings",
};

function fileExtension(fileName: string): string {
  const normalized = fileName.toLowerCase();
  const parts = normalized.split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function fileIconStyle(fileName: string): FileIconProps {
  const normalizedName = fileName.toLowerCase();
  const extension = fileExtension(fileName);
  const defaultStyle = extension ? defaultStyles[extension] ?? {} : {};
  const type = EXTENSION_TYPE_OVERRIDES[extension] ?? defaultStyle.type;
  return {
    ...defaultStyle,
    ...SPECIAL_FILE_STYLES[normalizedName],
    extension: extension || undefined,
    fold: false,
    labelUppercase: false,
    radius: 5,
    type,
  };
}

export function WorkspaceFileIcon(props: WorkspaceFileIconProps) {
  if (props.entry.kind === "directory") {
    return (
      <Folder
        aria-hidden="true"
        className="size-3.5 shrink-0 text-primary"
        data-workspace-icon="folder"
      />
    );
  }

  const extension = fileExtension(props.entry.name);
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-3.5 shrink-0 items-center justify-center overflow-hidden", extension ? null : "opacity-85")}
      data-file-extension={extension || "unknown"}
      data-workspace-icon="file-type"
    >
      <FileIcon {...fileIconStyle(props.entry.name)} />
    </span>
  );
}
