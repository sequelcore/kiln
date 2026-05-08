import type {
  InteractiveActionMetadata,
  InteractiveObservationMetadata,
} from "@kilnai/core";
import type {
  InteractiveUseProvider,
  InteractiveUseProviderResult,
  InteractiveUseRequest,
} from "@kilnai/core";

export const NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE =
  "Windows computer use provider is not available. Install the optional peer dependency '@nut-tree/nut-js' in the runtime host before enabling interactiveUse.computerProvider=windows. For Bun: bun add -d @nut-tree/nut-js.";

export interface WindowsComputerUseProviderOptions {
  readonly allowComputer?: boolean;
  readonly allowedApplications?: readonly string[];
  readonly activeApplicationResolver?: ActiveApplicationResolver;
  readonly loader?: NutJsLoader;
}

export type NutJsLoader = () => Promise<NutJsModule>;
export type ActiveApplicationResolver = (
  nut: NutJsModule,
  request: InteractiveUseRequest,
) => Promise<string | undefined> | string | undefined;

interface NutJsModule {
  readonly Button: Record<string, unknown>;
  readonly Key: Record<string, unknown>;
  readonly Point: new (x: number, y: number) => { readonly x: number; readonly y: number };
  readonly straightTo: (point: { readonly x: number; readonly y: number }) => unknown;
  readonly mouse: {
    readonly move: (movement: unknown) => Promise<void>;
    readonly click: (button: unknown) => Promise<void>;
  };
  readonly keyboard: {
    readonly type: (...input: readonly unknown[]) => Promise<void>;
  };
  readonly screen: {
    readonly width: () => Promise<number>;
    readonly height: () => Promise<number>;
    readonly capture: () => Promise<NutJsImage>;
  };
}

interface NutJsImage {
  readonly width?: number;
  readonly height?: number;
  readonly toDataURL?: () => string;
}

export class WindowsComputerUseProvider implements InteractiveUseProvider {
  private readonly allowComputer: boolean;
  private readonly allowedApplications: readonly string[];
  private readonly activeApplicationResolver?: ActiveApplicationResolver;
  private readonly loader: NutJsLoader;

  constructor(options: WindowsComputerUseProviderOptions = {}) {
    this.allowComputer = options.allowComputer === true;
    this.allowedApplications = normalizeList(options.allowedApplications);
    this.activeApplicationResolver = options.activeApplicationResolver;
    this.loader = options.loader ?? loadNutJs;
  }

  async execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    this.assertComputerAllowed();
    const nut = await this.loader();
    const activeApplication = await this.resolveActiveApplication(nut, request);
    this.assertApplicationAllowed(activeApplication);

    switch (request.operation) {
      case "observe":
        return {
          provider: "windows-nutjs",
          observation: await this.observe(nut, request, activeApplication),
        };
      case "click":
        await this.click(nut, request.action, request.input);
        return {
          provider: "windows-nutjs",
          observation: await this.observe(nut, request, activeApplication),
        };
      case "type":
        await nut.keyboard.type(readText(request.input));
        return {
          provider: "windows-nutjs",
          observation: await this.observe(nut, request, activeApplication),
        };
      case "keypress":
        await nut.keyboard.type(...readKeys(request.input).map((key) => mapKey(nut, key)));
        return {
          provider: "windows-nutjs",
          observation: await this.observe(nut, request, activeApplication),
        };
      case "open_application":
      case "focus_application":
      case "minimize_application":
      case "close_application":
        throw new Error(`Windows Nut.js computer provider does not support operation '${request.operation}'. Use computerProvider=windows-uia for application lifecycle control.`);
      default:
        throw new Error(`Windows computer provider does not support operation '${request.operation}'.`);
    }
  }

  private async observe(
    nut: NutJsModule,
    request: InteractiveUseRequest,
    activeApplication: string | undefined,
  ): Promise<InteractiveObservationMetadata> {
    const [width, height] = await Promise.all([
      nut.screen.width().catch(() => undefined),
      nut.screen.height().catch(() => undefined),
    ]);
    const screenshotDataUrl = request.observationRequest?.includeScreenshot === true || request.input.includeScreenshot === true
      ? await captureDataUrl(nut).catch(() => undefined)
      : undefined;
    return {
      ...stringField("application", activeApplication),
      ...stringField("windowTitle", readString(request.input.windowTitle)),
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
      ...(typeof width === "number" && typeof height === "number" ? { visibleText: `screen ${width}x${height}` } : {}),
    };
  }

  private async click(
    nut: NutJsModule,
    action: InteractiveActionMetadata | undefined,
    input: Record<string, unknown>,
  ): Promise<void> {
    const point = readPoint(input.target) ?? readActionPoint(action);
    if (!point) {
      throw new Error("Computer click requires target coordinates.");
    }
    await nut.mouse.move(nut.straightTo(new nut.Point(point.x, point.y)));
    await nut.mouse.click(mapButton(nut, action?.button ?? readButton(input.target) ?? "left"));
  }

  private assertComputerAllowed(): void {
    if (!this.allowComputer) {
      throw new Error("Computer automation is disabled. Set interactiveUse.allowComputer=true before using computer tools.");
    }
    if (this.allowedApplications.length === 0) {
      throw new Error("Computer automation application policy is missing. Configure interactiveUse.allowedApplications before using computer tools.");
    }
  }

  private async resolveActiveApplication(
    nut: NutJsModule,
    request: InteractiveUseRequest,
  ): Promise<string | undefined> {
    if (!this.activeApplicationResolver) {
      if (this.allowedApplications.some((entry) => entry === "*")) {
        return undefined;
      }
      throw new Error("Computer automation requires a trusted active application resolver before using Windows computer tools. Configure the runtime host to report the active application and set interactiveUse.allowedApplications.");
    }
    const application = await this.activeApplicationResolver(nut, request);
    return readString(application) ?? undefined;
  }

  private assertApplicationAllowed(application: string | undefined): void {
    if (this.allowedApplications.some((entry) => entry === "*")) {
      return;
    }
    if (!application) {
      throw new Error("Computer automation could not determine the active application. Configure a trusted active application resolver before using Windows computer tools.");
    }
    const allowed = this.allowedApplications.some((entry) => entry.toLocaleLowerCase("en-US") === application.toLocaleLowerCase("en-US"));
    if (!allowed) {
      throw new Error(`Computer automation denied for application '${application}'. Configure interactiveUse.allowedApplications to allow it.`);
    }
  }
}

async function loadNutJs(): Promise<NutJsModule> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<NutJsModule>;
    return await dynamicImport("@nut-tree/nut-js");
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE
        ? error.message
        : NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
    );
  }
}

async function captureDataUrl(nut: NutJsModule): Promise<string | undefined> {
  const image = await nut.screen.capture();
  return typeof image.toDataURL === "function" ? image.toDataURL() : undefined;
}

function mapButton(nut: NutJsModule, button: string): unknown {
  if (button === "right") return nut.Button.RIGHT ?? nut.Button.Right ?? "right";
  if (button === "middle") return nut.Button.MIDDLE ?? nut.Button.Middle ?? "middle";
  return nut.Button.LEFT ?? nut.Button.Left ?? "left";
}

function mapKey(nut: NutJsModule, key: string): unknown {
  return nut.Key[key] ?? key;
}

function readText(input: Record<string, unknown>): string {
  if (typeof input.text !== "string") {
    throw new Error("Computer type requires text.");
  }
  return input.text;
}

function readKeys(input: Record<string, unknown>): readonly string[] {
  return Array.isArray(input.keys)
    ? input.keys.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readPoint(value: unknown): { readonly x: number; readonly y: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number" && Number.isFinite(record.x) && typeof record.y === "number" && Number.isFinite(record.y)
    ? { x: record.x, y: record.y }
    : null;
}

function readActionPoint(action: InteractiveActionMetadata | undefined): { readonly x: number; readonly y: number } | null {
  return typeof action?.x === "number" && typeof action.y === "number"
    ? { x: action.x, y: action.y }
    : null;
}

function readButton(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const button = (value as Record<string, unknown>).button;
  return typeof button === "string" ? button : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringField<TName extends string>(name: TName, value: string | null | undefined): Record<TName, string> | Record<string, never> {
  return value ? { [name]: value } as Record<TName, string> : {};
}

function normalizeList(value: readonly string[] | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const normalized = item.trim();
    if (normalized && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}
