import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MarkdownTableProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function MarkdownTable(props: MarkdownTableProps) {
  return (
    <ScrollArea
      aria-label="Scrollable markdown table"
      className="my-3 max-w-full rounded-md border border-border/70"
      data-markdown-table-scroll=""
      orientation="horizontal"
    >
      <table className={cn("w-max min-w-full table-auto border-collapse text-left text-sm", props.className)}>
        {props.children}
      </table>
    </ScrollArea>
  );
}

export function MarkdownTableHeadCell(props: MarkdownTableProps) {
  return (
    <th className="min-w-36 border-b border-r border-border/70 bg-background-element px-3 py-2 align-bottom font-semibold last:border-r-0">
      {props.children}
    </th>
  );
}

export function MarkdownTableCell(props: MarkdownTableProps) {
  return (
    <td className="min-w-40 border-r border-t border-border/60 px-3 py-2 align-top last:border-r-0">
      {props.children}
    </td>
  );
}
