import type { KilnAppConfig } from "../config.js";
import {
  buildHarnessDoctorReport,
  renderHarnessDoctorText,
  type HarnessDoctorOptions,
} from "../application/harness-doctor.js";

export interface DoctorCommandOptions extends HarnessDoctorOptions {
  readonly json?: boolean;
}

export async function doctorCommand(
  _appConfig: KilnAppConfig,
  options: DoctorCommandOptions = {},
): Promise<void> {
  const report = await buildHarnessDoctorReport({
    ...options,
    projectRoot: options.projectRoot ?? process.cwd(),
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(renderHarnessDoctorText(report));
}
