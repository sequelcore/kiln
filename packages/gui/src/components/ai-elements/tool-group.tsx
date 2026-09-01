import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function ToolGroupItem(props: ComponentProps<"li">) {
  return <li {...props} className={cn("min-w-0", props.className)} />;
}
