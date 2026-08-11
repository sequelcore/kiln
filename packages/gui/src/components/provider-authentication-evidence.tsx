import { Button } from "@/components/ui/button";
import type { ProviderAuthDetails } from "../lib/session-store/index.js";

interface ProviderAuthenticationEvidenceProps {
  readonly details: ProviderAuthDetails;
  readonly message?: string | null;
  readonly copyNotice: string | null;
  readonly onCopy: (text: string, label: string) => void;
}

export function ProviderAuthenticationEvidence(props: ProviderAuthenticationEvidenceProps) {
  const authenticationUri =
    props.details.method === "browser_oauth" ? props.details.authorizationUri : props.details.verificationUri;
  return (
    <section className="flex flex-col gap-3 border-t border-border px-4 py-3" aria-label="Provider authentication">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">Complete browser sign-in</p>
        {props.message ? <p className="text-xs text-muted-foreground">{props.message}</p> : null}
      </div>
      {props.details.method === "device_code" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-2 text-xs">
          <dt className="text-muted-foreground">Link</dt>
          <dd>
            <code className="select-all break-all text-foreground">{props.details.verificationUri}</code>
          </dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd>
            <code className="select-all text-lg tracking-wide text-foreground">{props.details.userCode}</code>
          </dd>
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => window.open(authenticationUri, "_blank", "noopener,noreferrer")}>
          {props.details.method === "browser_oauth" ? "Open secure sign-in" : "Open link"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => props.onCopy(authenticationUri, "Link")}>
          Copy link
        </Button>
        {props.details.method === "device_code" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (props.details.method === "device_code") props.onCopy(props.details.userCode, "Code");
            }}
          >
            Copy code
          </Button>
        ) : null}
      </div>
      {props.copyNotice ? (
        <p className="text-xs text-muted-foreground" role="status">
          {props.copyNotice}
        </p>
      ) : null}
    </section>
  );
}
