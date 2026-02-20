// Pure cron expression parser and next-fire-time calculator
// Supports: *, ranges (1-5), steps (*/15), lists (1,3,5)
// 5-field format: minute hour day-of-month month day-of-week

import { KilnError } from "../errors.js";

/** Parsed cron expression */
export interface CronExpression {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
}

const FIELD_RANGES: readonly [number, number][] = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day of month
  [1, 12],   // month
  [0, 6],    // day of week (0=Sunday)
];

/** Parse a single cron field into an array of matching values */
function parseField(field: string, min: number, max: number, fieldName: string): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // Step: */N or M-N/S
    const stepMatch = trimmed.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[4]!, 10);
      if (step === 0) throw new KilnError("SCHEDULE_PARSE_FAILED", `Invalid step 0 in ${fieldName}`, { retryable: false });
      let start = min;
      let end = max;
      if (stepMatch[2] !== undefined && stepMatch[3] !== undefined) {
        start = parseInt(stepMatch[2], 10);
        end = parseInt(stepMatch[3], 10);
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    // Range: M-N
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      if (start > end) throw new KilnError("SCHEDULE_PARSE_FAILED", `Invalid range ${start}-${end} in ${fieldName}`, { retryable: false });
      if (start < min || end > max) throw new KilnError("SCHEDULE_PARSE_FAILED", `Range ${start}-${end} out of bounds (${min}-${max}) in ${fieldName}`, { retryable: false });
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    // Single value
    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num)) throw new KilnError("SCHEDULE_PARSE_FAILED", `Invalid value "${trimmed}" in ${fieldName}`, { retryable: false });
    if (num < min || num > max) throw new KilnError("SCHEDULE_PARSE_FAILED", `Value ${num} out of bounds (${min}-${max}) in ${fieldName}`, { retryable: false });
    values.add(num);
  }

  return [...values].sort((a, b) => a - b);
}

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"] as const;

/** Parse a 5-field cron expression */
export function parseCronExpression(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new KilnError("SCHEDULE_PARSE_FAILED", `Expected 5 fields, got ${fields.length}: "${expression}"`, { retryable: false });
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields.map((field, i) =>
    parseField(field!, FIELD_RANGES[i]![0], FIELD_RANGES[i]![1], FIELD_NAMES[i]!),
  );

  return { minutes: minutes!, hours: hours!, daysOfMonth: daysOfMonth!, months: months!, daysOfWeek: daysOfWeek! };
}

/** Validate a cron expression. Returns null if valid, error message if invalid. */
export function validateCronExpression(expression: string): string | null {
  try {
    parseCronExpression(expression);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Calculate the next fire time after the given date */
export function nextFireTime(expression: CronExpression, after: Date): Date {
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // Start from next minute

  // Search up to 4 years ahead to avoid infinite loops
  const limit = new Date(after.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);

  while (d < limit) {
    if (!expression.months.includes(d.getMonth() + 1)) {
      // Skip to next month
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }

    if (!expression.daysOfMonth.includes(d.getDate()) || !expression.daysOfWeek.includes(d.getDay())) {
      // Skip to next day
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }

    if (!expression.hours.includes(d.getHours())) {
      // Skip to next hour
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!expression.minutes.includes(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1);
      continue;
    }

    return new Date(d.getTime());
  }

  throw new KilnError("SCHEDULE_PARSE_FAILED", "No matching time found within 4 years", { retryable: false });
}
