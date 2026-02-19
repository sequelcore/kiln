import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Terminal, ArrowDown } from "lucide-react";

const MAX_VISIBLE_LINES = 200;

interface TerminalOutputProps {
  lines: string[];
}

export function TerminalOutput({ lines }: TerminalOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Auto-scroll when new lines arrive and user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [lines.length, isAtBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  const visible = lines.slice(-MAX_VISIBLE_LINES);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 p-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          Output
        </CardTitle>
        {visible.length > 0 && (
          <Badge variant="secondary" className="text-xs font-mono">
            {lines.length} lines
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto bg-[#050505] rounded-b-xl font-mono text-xs leading-relaxed p-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-800"
        >
          {visible.length === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground/50">
              <span className="inline-block w-2 h-4 bg-muted-foreground/30 animate-pulse" />
              <span>Waiting for output...</span>
            </div>
          ) : (
            visible.map((line, i) => (
              <div
                key={i}
                className="flex gap-3 hover:bg-white/[0.02] -mx-1 px-1 rounded"
              >
                <span className="text-muted-foreground/30 select-none w-8 text-right shrink-0 tabular-nums">
                  {lines.length - visible.length + i + 1}
                </span>
                <span className="text-emerald-300/80 whitespace-pre-wrap break-all">
                  {line}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Scroll to bottom button */}
        {!isAtBottom && visible.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 h-7 text-xs shadow-lg"
          >
            <ArrowDown className="h-3 w-3" />
            Bottom
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
