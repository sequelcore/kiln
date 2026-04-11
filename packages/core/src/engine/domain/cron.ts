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

/** Validate an IANA timezone string. Returns null if valid, error message if invalid. */
export function validateTimezone(tz: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return null;
  } catch {
    return `Invalid timezone: "${tz}". Use an IANA timezone identifier (e.g., "America/New_York", "Europe/London", "UTC").`;
  }
}

interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly dayOfWeek: number;
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  zonedFormatterCache.set(timezone, formatter);
  return formatter;
}

function getDateParts(date: Date, timezone?: string): ZonedDateParts {
  if (!timezone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      dayOfWeek: date.getDay(),
    };
  }

  if (timezone === "UTC") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dayOfWeek: date.getUTCDay(),
    };
  }

  const parts = getZonedFormatter(timezone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0,
  };
}

/** Calculate the next fire time after the given date */
export function nextFireTime(
  expression: CronExpression,
  after: Date,
  timezone?: string,
): Date {
  if (!timezone) {
    const d = new Date(after.getTime());
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);

    const limit = new Date(after.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);

    while (d < limit) {
      if (!expression.months.includes(d.getMonth() + 1)) {
        d.setMonth(d.getMonth() + 1, 1);
        d.setHours(0, 0, 0, 0);
        continue;
      }

      if (
        !expression.daysOfMonth.includes(d.getDate()) ||
        !expression.daysOfWeek.includes(d.getDay())
      ) {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        continue;
      }

      if (!expression.hours.includes(d.getHours())) {
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

  const d = new Date(after.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const limit = new Date(after.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);

  while (d < limit) {
    const targetDate = getDateParts(d, timezone);

    if (!expression.months.includes(targetDate.month)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (
      !expression.daysOfMonth.includes(targetDate.day) ||
      !expression.daysOfWeek.includes(targetDate.dayOfWeek)
    ) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (!expression.hours.includes(targetDate.hour)) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    if (!expression.minutes.includes(targetDate.minute)) {
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      continue;
    }

    return new Date(d.getTime());
  }

  throw new KilnError("SCHEDULE_PARSE_FAILED", "No matching time found within 4 years", { retryable: false });
}
