declare module "react-file-icon" {
  import type { ComponentType } from "react";

  export type FileIconGlyph =
    | "3d"
    | "acrobat"
    | "android"
    | "audio"
    | "binary"
    | "code"
    | "code2"
    | "compressed"
    | "document"
    | "drive"
    | "font"
    | "image"
    | "presentation"
    | "settings"
    | "spreadsheet"
    | "vector"
    | "video";

  export interface FileIconProps {
    readonly color?: string;
    readonly extension?: string;
    readonly fold?: boolean;
    readonly foldColor?: string;
    readonly glyphColor?: string;
    readonly gradientColor?: string;
    readonly gradientOpacity?: number;
    readonly labelColor?: string;
    readonly labelTextColor?: string;
    readonly labelUppercase?: boolean;
    readonly radius?: number;
    readonly type?: FileIconGlyph;
  }

  export const FileIcon: ComponentType<FileIconProps>;
  export const defaultStyles: Record<string, FileIconProps>;
}
