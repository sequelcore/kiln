import type { QualityGate } from "../lib/protocol";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Check, X } from "lucide-react";

interface QualityGatesProps {
  gates: QualityGate[];
}

export function QualityGates({ gates }: QualityGatesProps) {
  const passed = gates.filter((g) => g.passed).length;

  return (
    <Card>
      <CardHeader className="pb-2 p-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" />
          Quality Gates
        </CardTitle>
        {gates.length > 0 && (
          <Badge
            variant={passed === gates.length ? "secondary" : "destructive"}
            className="text-xs"
          >
            {passed}/{gates.length}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {gates.length === 0 ? (
          <p className="text-sm text-muted-foreground/50">No gates evaluated yet</p>
        ) : (
          <div className="space-y-1.5">
            {gates.map((gate) => (
              <div key={gate.name} className="flex items-center gap-2 text-sm">
                {gate.passed ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-red-400 shrink-0" />
                )}
                <span className={gate.passed ? "text-muted-foreground" : "text-red-300"}>
                  {gate.name}
                </span>
                {gate.message && (
                  <span className="text-muted-foreground/50 text-xs ml-auto truncate max-w-48">
                    {gate.message}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
