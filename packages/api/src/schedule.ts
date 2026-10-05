/**
 * When rounds close: one fixed weekly slot in one time zone, e.g. Sundays at
 * 20:00 in Australia/Melbourne. The slot is wall-clock time in that zone, so it
 * stays at 8 pm across daylight-saving changes.
 *
 * Pure date arithmetic on `Intl`; no date library.
 */

export interface RoundSchedule {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  hour: number;
  minute: number;
  /** IANA zone, e.g. `Australia/Melbourne`. */
  timeZone: string;
}

/** The first slot strictly after `now`. */
export function nextRoundAt(now: Date, schedule: RoundSchedule): Date {
  const today = zonedParts(now, schedule.timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (day.getUTCDay() !== schedule.weekday) continue;
    const candidate = zonedTimeToUtc(
      { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: schedule.hour, minute: schedule.minute },
      schedule.timeZone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  // Unreachable: some day within the next 8 has the weekday and lies after now.
  throw new Error('no round slot found');
}

/** Parse `SUN 20:00`-style settings; throws with a readable message on bad input. */
export function parseSchedule(day: string, time: string, timeZone: string): RoundSchedule {
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(day.trim().slice(0, 3).toUpperCase());
  if (weekday === -1) throw new Error(`ROUND_DAY must be a weekday such as SUN, got "${day}".`);
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (match === null || hour > 23 || minute > 59) throw new Error(`ROUND_TIME must be HH:MM, got "${time}".`);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`ROUND_TIMEZONE must be an IANA zone such as Australia/Melbourne, got "${timeZone}".`);
  }
  return { weekday, hour, minute, timeZone };
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Offset of the zone from UTC at `date`, in ms (positive east of Greenwich). */
function zoneOffset(date: Date, timeZone: string): number {
  const wall = zonedParts(date, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant that reads as `wall` in the zone. Two passes settle DST edges. */
function zonedTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let instant = naive - zoneOffset(new Date(naive), timeZone);
  instant = naive - zoneOffset(new Date(instant), timeZone);
  return new Date(instant);
}
