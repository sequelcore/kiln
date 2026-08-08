import {
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  type OperatorProjectBinding,
  type OperatorProjectRuntimeStatus,
  type OperatorSessionClaims,
} from "@kilnai/gateway-contracts";

export interface ProjectRuntimeRegistryDescriptor {
  /** Server-verified real path. This value never crosses the registry's public boundary. */
  readonly canonicalRoot: string;
  readonly binding: OperatorProjectBinding;
}

export interface ProjectRuntimeOwner {
  close(): void | Promise<void>;
}

export type ProjectRuntimeFactory<Runtime extends ProjectRuntimeOwner> = (
  descriptor: ProjectRuntimeRegistryDescriptor,
) => Runtime | Promise<Runtime>;

export type ProjectRuntimeRegistryErrorCode =
  | "close_failed"
  | "identity_collision"
  | "runtime_unavailable"
  | "stale_binding";

export class ProjectRuntimeRegistryError extends Error {
  readonly code: ProjectRuntimeRegistryErrorCode;
  readonly failureCount: number | undefined;

  constructor(code: ProjectRuntimeRegistryErrorCode, failureCount?: number) {
    super(errorMessage(code));
    this.name = "ProjectRuntimeRegistryError";
    this.code = code;
    this.failureCount = failureCount;
  }
}

interface ProjectRuntimeEntry<Runtime extends ProjectRuntimeOwner> {
  readonly canonicalRoot: string;
  binding: OperatorProjectBinding;
  runtime?: Runtime;
  readonly creation: Promise<Runtime>;
  closing?: Promise<void>;
  lifecycle: OperatorProjectRuntimeStatus["lifecycle"];
  diagnostic: OperatorProjectRuntimeStatus["diagnostic"];
}

export class ProjectRuntimeRegistry<Runtime extends ProjectRuntimeOwner> {
  readonly #entries = new Map<string, ProjectRuntimeEntry<Runtime>>();
  readonly #factory: ProjectRuntimeFactory<Runtime>;

  constructor(factory: ProjectRuntimeFactory<Runtime>) {
    this.#factory = factory;
  }

  ensure(descriptor: ProjectRuntimeRegistryDescriptor): Promise<Runtime> {
    const projectRuntimeId = descriptor.binding.projectRuntimeId;
    const existing = this.#entries.get(projectRuntimeId);
    if (existing) {
      if (existing.canonicalRoot !== descriptor.canonicalRoot) {
        return Promise.reject(
          new ProjectRuntimeRegistryError("identity_collision"),
        );
      }
      if (existing.closing) {
        return existing.closing.then(() => this.ensure(descriptor));
      }

      if (existing.binding.markerDigest === descriptor.binding.markerDigest)
        return existing.creation;

      return this.close(projectRuntimeId).then(() => this.ensure(descriptor));
    }

    return this.#create(descriptor);
  }

  lookup(binding: OperatorProjectBinding | OperatorSessionClaims): Runtime {
    const entry = this.#entries.get(binding.projectRuntimeId);
    if (!entry || !entry.runtime || entry.closing) {
      throw new ProjectRuntimeRegistryError("runtime_unavailable");
    }
    if (entry.binding.markerDigest !== binding.markerDigest) {
      throw new ProjectRuntimeRegistryError("stale_binding");
    }
    return entry.runtime;
  }

  statuses(): OperatorProjectRuntimeStatus[] {
    return [...this.#entries.values()].map((entry) => ({
      protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
      binding: copyBinding(entry.binding),
      lifecycle: entry.lifecycle,
      diagnostic: entry.diagnostic,
    }));
  }

  close(projectRuntimeId: string, expectedMarkerDigest?: string): Promise<void> {
    const entry = this.#entries.get(projectRuntimeId);
    if (!entry) return Promise.resolve();
    if (expectedMarkerDigest !== undefined && entry.binding.markerDigest !== expectedMarkerDigest)
      return Promise.resolve();
    if (entry.closing) return entry.closing;

    entry.lifecycle = "unavailable";
    entry.diagnostic = "project_unavailable";
    const closing = this.#closeEntry(projectRuntimeId, entry);
    entry.closing = closing;
    return closing;
  }

  async closeAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#entries.keys()].map((projectRuntimeId) =>
        this.close(projectRuntimeId),
      ),
    );
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failureCount > 0)
      throw new ProjectRuntimeRegistryError("close_failed", failureCount);
  }

  #create(descriptor: ProjectRuntimeRegistryDescriptor): Promise<Runtime> {
    const ownedDescriptor: ProjectRuntimeRegistryDescriptor = {
      canonicalRoot: descriptor.canonicalRoot,
      binding: copyBinding(descriptor.binding),
    };
    let resolveCreation!: (runtime: Runtime | PromiseLike<Runtime>) => void;
    let rejectCreation!: (reason?: unknown) => void;
    const creation = new Promise<Runtime>((resolve, reject) => {
      resolveCreation = resolve;
      rejectCreation = reject;
    });
    const entry: ProjectRuntimeEntry<Runtime> = {
      canonicalRoot: ownedDescriptor.canonicalRoot,
      binding: ownedDescriptor.binding,
      creation,
      lifecycle: "starting",
      diagnostic: "none",
    };
    this.#entries.set(ownedDescriptor.binding.projectRuntimeId, entry);

    let factoryResult: Runtime | Promise<Runtime>;
    try {
      factoryResult = this.#factory(ownedDescriptor);
    } catch (error) {
      this.#removeFailedCreation(
        ownedDescriptor.binding.projectRuntimeId,
        entry,
      );
      rejectCreation(error);
      return creation;
    }

    Promise.resolve(factoryResult).then(
      (runtime) => {
        entry.runtime = runtime;
        if (!entry.closing) {
          entry.lifecycle = "ready";
          entry.diagnostic = "none";
        }
        resolveCreation(runtime);
      },
      (error: unknown) => {
        this.#removeFailedCreation(
          ownedDescriptor.binding.projectRuntimeId,
          entry,
        );
        rejectCreation(error);
      },
    );
    return creation;
  }

  #removeFailedCreation(
    projectRuntimeId: string,
    entry: ProjectRuntimeEntry<Runtime>,
  ): void {
    if (this.#entries.get(projectRuntimeId) === entry && !entry.closing)
      this.#entries.delete(projectRuntimeId);
  }

  async #closeEntry(
    projectRuntimeId: string,
    entry: ProjectRuntimeEntry<Runtime>,
  ): Promise<void> {
    let closeFailed = false;
    try {
      const runtime = await entry.creation.catch(() => undefined);
      if (runtime) {
        try {
          await runtime.close();
        } catch {
          closeFailed = true;
        }
      }
    } finally {
      if (!closeFailed && this.#entries.get(projectRuntimeId) === entry)
        this.#entries.delete(projectRuntimeId);
    }
    if (closeFailed)
      throw new ProjectRuntimeRegistryError("close_failed", 1);
  }
}

function copyBinding(binding: OperatorProjectBinding): OperatorProjectBinding {
  return {
    projectRuntimeId: binding.projectRuntimeId,
    markerDigest: binding.markerDigest,
  };
}

function errorMessage(code: ProjectRuntimeRegistryErrorCode): string {
  switch (code) {
    case "close_failed":
      return "Project runtime close failed";
    case "identity_collision":
      return "Project runtime identity collision";
    case "runtime_unavailable":
      return "Project runtime is unavailable";
    case "stale_binding":
      return "Project runtime binding is stale";
  }
}
