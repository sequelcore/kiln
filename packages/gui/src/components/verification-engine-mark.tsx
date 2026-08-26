import dafnyMarkUrl from "@/assets/verification-engines/dafny.svg?url";
import gentleAiMarkUrl from "@/assets/verification-engines/gentle-ai.png?url";
import { cn } from "@/lib/utils";

type VerificationEnginePresentation =
  | { readonly kind: "asset"; readonly label: string; readonly brand: string; readonly markUrl: string }
  | { readonly kind: "pictogram"; readonly label: string; readonly pictogram: "static-analysis" }
  | { readonly kind: "monogram"; readonly label: string };

const VERIFICATION_ENGINES: Readonly<Record<string, VerificationEnginePresentation>> = {
  dafny: { kind: "asset", label: "Dafny", brand: "dafny", markUrl: dafnyMarkUrl },
  oxlint: { kind: "pictogram", label: "Oxlint", pictogram: "static-analysis" },
  "gentle-ai": { kind: "asset", label: "Gentle AI", brand: "gentle-ai", markUrl: gentleAiMarkUrl },
  "kiln-quality": { kind: "monogram", label: "Kiln Quality" },
};

interface VerificationEngineMarkProps {
  readonly engineName: string;
  readonly className?: string;
}

/** GUI-owned recognition only. Verification identity and authority remain in gateway contracts. */
export function VerificationEngineMark({ className, engineName }: VerificationEngineMarkProps) {
  const presentation = VERIFICATION_ENGINES[engineName];
  if (presentation?.kind === "pictogram") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background text-foreground",
          className,
        )}
        data-verification-engine-mark="static-analysis"
      >
        <StaticAnalysisPictogram />
      </span>
    );
  }
  if (presentation?.kind !== "asset") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background font-mono text-[0.625rem] font-semibold uppercase text-muted-foreground",
          className,
        )}
        data-verification-engine-fallback={engineName}
      >
        {engineMonogram(presentation?.label ?? engineName)}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background", className)}
      data-verification-engine-mark={presentation.brand}
    >
      <img alt="" className="size-full object-contain" src={presentation.markUrl} />
    </span>
  );
}

function StaticAnalysisPictogram() {
  return (
    <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24">
      <path d="m8 6-4 6 4 6M16 6l4 6-4 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
      <path d="m9.5 12 1.75 1.75L15 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
  );
}

export function verificationEngineLabel(engineName: string): string {
  return VERIFICATION_ENGINES[engineName]?.label ?? engineName;
}

function engineMonogram(label: string): string {
  const words = label.trim().split(/[-_\s]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  return words.slice(0, 2).map((word) => word.slice(0, 1)).join("");
}
