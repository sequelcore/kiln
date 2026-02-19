import type { ProviderAdapter, AgentRole } from "./index.js";

/** Registry for managing multiple LLM providers with per-role assignment. */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly roleMapping = new Map<AgentRole, string>();
  private _default: string | null = null;

  /** Register a provider adapter by name. */
  register(name: string, adapter: ProviderAdapter): void {
    this.adapters.set(name, adapter);
  }

  /** Retrieve a provider adapter by name. */
  get(name: string): ProviderAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Assign a specific provider to an agent role. */
  setRoleProvider(role: AgentRole, providerName: string): void {
    if (!this.adapters.has(providerName)) {
      throw new Error(`Provider not registered: ${providerName}`);
    }
    this.roleMapping.set(role, providerName);
  }

  /**
   * Get the provider for a given role.
   * Resolution order: role-specific -> default -> first registered -> throw.
   */
  getForRole(role: AgentRole): ProviderAdapter {
    // 1. Role-specific mapping
    const roleName = this.roleMapping.get(role);
    if (roleName) {
      const adapter = this.adapters.get(roleName);
      if (adapter) return adapter;
    }

    // 2. Default provider
    if (this._default) {
      const adapter = this.adapters.get(this._default);
      if (adapter) return adapter;
    }

    // 3. First registered adapter
    const first = this.adapters.values().next();
    if (!first.done) return first.value;

    // 4. Throw
    throw new Error(`No provider available for role: ${role}`);
  }

  /** Set the default fallback provider. */
  defaultProvider(name: string): void {
    if (!this.adapters.has(name)) {
      throw new Error(`Provider not registered: ${name}`);
    }
    this._default = name;
  }

  /** Return all registered adapters. */
  all(): Map<string, ProviderAdapter> {
    return new Map(this.adapters);
  }

  /** Return role-to-provider mappings. */
  roles(): Map<AgentRole, string> {
    return new Map(this.roleMapping);
  }
}
