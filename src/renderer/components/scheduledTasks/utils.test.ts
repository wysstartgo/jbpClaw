import { describe, expect, test } from 'vitest';

import type { Schedule, ScheduledTaskChannelOption } from '../../../scheduledTask/types';
import {
  formatNextRunRelative,
  formatScheduleLabel,
  isSavedOnlyScheduledTaskChannelOption,
  mergeScheduledTaskChannelOptions,
  scheduledTaskChannelOptionKey,
  scheduleToPlanInfo,
} from './utils';

describe('scheduled task utils', () => {
  test('parses hourly cron plans', () => {
    const schedule: Schedule = { kind: 'cron', expr: '15 * * * *' };

    expect(scheduleToPlanInfo(schedule)).toMatchObject({
      planType: 'hourly',
      minute: 15,
    });
    expect(formatScheduleLabel(schedule)).toContain('15');
  });

  test('parses weekly multi-day cron plans', () => {
    const schedule: Schedule = { kind: 'cron', expr: '30 9 * * 1,3,5' };

    expect(scheduleToPlanInfo(schedule)).toMatchObject({
      planType: 'weekly',
      hour: 9,
      minute: 30,
      weekdays: [1, 3, 5],
    });
    expect(formatScheduleLabel(schedule)).toContain('09:30');
  });

  test('parses once schedules into local date and time fields', () => {
    const runAt = new Date(2026, 4, 11, 8, 30, 15);
    const schedule: Schedule = { kind: 'at', at: runAt.toISOString() };

    expect(scheduleToPlanInfo(schedule)).toMatchObject({
      planType: 'once',
      year: 2026,
      month: 5,
      day: 11,
      hour: 8,
      minute: 30,
      second: 15,
    });
  });

  test('parses daily and monthly cron plans', () => {
    expect(scheduleToPlanInfo({ kind: 'cron', expr: '5 7 * * *' })).toMatchObject({
      planType: 'daily',
      hour: 7,
      minute: 5,
    });

    expect(scheduleToPlanInfo({ kind: 'cron', expr: '45 6 15 * *' })).toMatchObject({
      planType: 'monthly',
      hour: 6,
      minute: 45,
      monthDay: 15,
    });
  });

  test('falls back to advanced for every schedules and complex cron plans', () => {
    expect(scheduleToPlanInfo({ kind: 'every', everyMs: 60_000 })).toMatchObject({
      planType: 'advanced',
    });

    expect(scheduleToPlanInfo({ kind: 'cron', expr: '*/5 9-18 * * 1-5' })).toMatchObject({
      planType: 'advanced',
    });
  });

  test('keeps saved multi-instance channel options after available channels refresh', () => {
    const available: ScheduledTaskChannelOption[] = [
      { value: 'feishu', label: '飞书 A', accountId: 'feishu-a' },
    ];
    const saved: ScheduledTaskChannelOption[] = [
      { value: 'feishu', label: '飞书旧实例', accountId: 'feishu-old' },
    ];

    const merged = mergeScheduledTaskChannelOptions(available, saved);

    expect(merged.map(scheduledTaskChannelOptionKey)).toEqual([
      'feishu::feishu-a',
      'feishu::feishu-old',
    ]);
    expect(isSavedOnlyScheduledTaskChannelOption(merged[0], available)).toBe(false);
    expect(isSavedOnlyScheduledTaskChannelOption(merged[1], available)).toBe(true);
  });

  test('formats next run relative labels', () => {
    const now = new Date('2026-05-19T00:00:00.000Z').getTime();

    expect(formatNextRunRelative(now + 30_000, now)).toBe('不到 1 分钟后');
    expect(formatNextRunRelative(now + 5 * 60_000, now)).toBe('5 分钟后');
    expect(formatNextRunRelative(now + 2 * 3_600_000, now)).toBe('2 小时后');
    expect(formatNextRunRelative(now - 1, now)).toBeNull();
  });
});
