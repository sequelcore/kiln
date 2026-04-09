import { ThresholdAllocator, type AgentThresholds, type TaskCategory } from "./threshold-allocator.js";
import { CascadeController, type CascadeConfig } from "./cascade-controller.js";

export interface TeamRole {
  readonly name: string;
  readonly category: TaskCategory;
  readonly thresholds: Partial<Record<TaskCategory, number>>;
  readonly required: boolean;
  readonly tools?: readonly string[];
  readonly pipelineOrder?: number;
}

export interface TeamTemplate {
  readonly id: string;
  readonly name: string;
  readonly domains: readonly string[];
  readonly roles: readonly TeamRole[];
  readonly cascadeConfig?: Partial<CascadeConfig>;
  readonly maxConcurrent: number;
}

export interface ComposedTeam {
  readonly templateId: string;
  readonly roles: readonly TeamRole[];
  readonly allocator: ThresholdAllocator;
  readonly cascadeController: CascadeController;
}

const JAVA_SPRING_TEMPLATE: TeamTemplate = {
  id: "java-spring",
  name: "Java Spring Team",
  domains: ["java", "spring", "gradle", "maven"],
  roles: [
    {
      name: "planner",
      category: "triage",
      thresholds: { triage: 0.3, research: 0.4 },
      required: true,
      pipelineOrder: 1,
    },
    {
      name: "implementer",
      category: "code",
      thresholds: { code: 0.2, ops: 0.6 },
      required: true,
      pipelineOrder: 2,
    },
    {
      name: "tdd-guide",
      category: "review",
      thresholds: { review: 0.3, code: 0.5 },
      required: true,
      pipelineOrder: 2,
    },
    {
      name: "reviewer",
      category: "review",
      thresholds: { review: 0.2, research: 0.5 },
      required: false,
      pipelineOrder: 3,
    },
    {
      name: "architect",
      category: "research",
      thresholds: { research: 0.2, triage: 0.4 },
      required: false,
      pipelineOrder: 1,
    },
  ],
  cascadeConfig: { maxDepth: 8 },
  maxConcurrent: 4,
};

const REACT_TYPESCRIPT_TEMPLATE: TeamTemplate = {
  id: "react-typescript",
  name: "React TypeScript Team",
  domains: ["react", "typescript", "vite", "next"],
  roles: [
    {
      name: "planner",
      category: "triage",
      thresholds: { triage: 0.3, research: 0.4 },
      required: true,
      pipelineOrder: 1,
    },
    {
      name: "implementer",
      category: "code",
      thresholds: { code: 0.2, writing: 0.5 },
      required: true,
      pipelineOrder: 2,
    },
    {
      name: "reviewer",
      category: "review",
      thresholds: { review: 0.2, code: 0.5 },
      required: true,
      pipelineOrder: 3,
    },
    {
      name: "designer",
      category: "writing",
      thresholds: { writing: 0.2, code: 0.6 },
      required: false,
      pipelineOrder: 2,
    },
  ],
  cascadeConfig: { maxDepth: 6 },
  maxConcurrent: 3,
};

const PYTHON_TEMPLATE: TeamTemplate = {
  id: "python",
  name: "Python Team",
  domains: ["python", "django", "fastapi", "flask"],
  roles: [
    {
      name: "planner",
      category: "triage",
      thresholds: { triage: 0.3 },
      required: true,
      pipelineOrder: 1,
    },
    {
      name: "implementer",
      category: "code",
      thresholds: { code: 0.2 },
      required: true,
      pipelineOrder: 2,
    },
    {
      name: "tester",
      category: "review",
      thresholds: { review: 0.3 },
      required: true,
      pipelineOrder: 3,
    },
  ],
  cascadeConfig: { maxDepth: 8 },
  maxConcurrent: 3,
};

const GENERIC_TEMPLATE: TeamTemplate = {
  id: "generic",
  name: "Generic Team",
  domains: [],
  roles: [
    {
      name: "planner",
      category: "triage",
      thresholds: { triage: 0.3 },
      required: true,
      pipelineOrder: 1,
    },
    {
      name: "worker",
      category: "general",
      thresholds: { general: 0.3, code: 0.4, writing: 0.4 },
      required: true,
      pipelineOrder: 2,
    },
    {
      name: "reviewer",
      category: "review",
      thresholds: { review: 0.3 },
      required: false,
      pipelineOrder: 3,
    },
  ],
  maxConcurrent: 3,
};

export const BUILTIN_TEMPLATES: readonly TeamTemplate[] = Object.freeze([
  JAVA_SPRING_TEMPLATE,
  REACT_TYPESCRIPT_TEMPLATE,
  PYTHON_TEMPLATE,
  GENERIC_TEMPLATE,
]);

export class TeamComposer {
  private readonly templates: Map<string, TeamTemplate>;

  constructor(customTemplates?: readonly TeamTemplate[]) {
    this.templates = new Map();
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
    if (customTemplates) {
      for (const template of customTemplates) {
        this.templates.set(template.id, template);
      }
    }
  }

  compose(domain: string, complexity: number): ComposedTeam {
    const template = this.findMatchingTemplate(domain);
    const roles = this.filterRoles(template.roles, complexity);

    const agentConfigs: AgentThresholds[] = roles.map((role) => ({
      agentId: role.name,
      thresholds: role.thresholds as AgentThresholds["thresholds"],
    }));

    const allocator = new ThresholdAllocator(agentConfigs);
    const cascadeController = new CascadeController(complexity, template.cascadeConfig);

    return {
      templateId: template.id,
      roles,
      allocator,
      cascadeController,
    };
  }

  getTemplate(id: string): TeamTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(): readonly TeamTemplate[] {
    return Array.from(this.templates.values());
  }

  registerTemplate(template: TeamTemplate): void {
    this.templates.set(template.id, template);
  }

  private findMatchingTemplate(domain: string): TeamTemplate {
    const domainLower = domain.toLowerCase();
    for (const template of this.templates.values()) {
      if (template.domains.some((d) => d.toLowerCase() === domainLower)) {
        return template;
      }
    }
    return this.templates.get("generic")!;
  }

  private filterRoles(roles: readonly TeamRole[], complexity: number): readonly TeamRole[] {
    if (complexity < 0.4) {
      return roles.filter((role) => role.required);
    }
    return roles;
  }
}
