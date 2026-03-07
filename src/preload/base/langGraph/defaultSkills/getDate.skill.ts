import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import moment from 'moment';

type DateUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

const UNIT_MAP: Record<string, DateUnit> = {
  year: 'year', years: 'year', 年: 'year',
  month: 'month', months: 'month', 月: 'month',
  week: 'week', weeks: 'week', 周: 'week', 星期: 'week',
  day: 'day', days: 'day', 天: 'day', 日: 'day',
  hour: 'hour', hours: 'hour', 时: 'hour', 小时: 'hour',
  minute: 'minute', minutes: 'minute', 分: 'minute', 分钟: 'minute',
  second: 'second', seconds: 'second', 秒: 'second',
};

const FORMAT_MAP: Record<DateUnit, string> = {
  year: 'YYYY年',
  month: 'YYYY年MM月',
  week: 'YYYY年 第ww周',
  day: 'YYYY年MM月DD日',
  hour: 'YYYY年MM月DD日 HH时',
  minute: 'YYYY年MM月DD日 HH:mm',
  second: 'YYYY年MM月DD日 HH:mm:ss',
};

export const getDateSkill = tool(
  async ({ value, unit }: { value: number; unit: string }) => {
    console.log('[skill] get_date, value:', value, 'unit:', unit);

    try {
      const normalizedUnit = UNIT_MAP[unit.toLowerCase()] ?? UNIT_MAP[unit];
      if (!normalizedUnit) {
        return JSON.stringify({
          error: `Unknown unit: "${unit}"`,
          hint: 'Supported units: year/年, month/月, week/周, day/天, hour/小时, minute/分钟, second/秒',
        });
      }

      const now = moment();
      const target = value === 0
        ? now.clone()
        : value > 0
          ? now.clone().add(value, normalizedUnit)
          : now.clone().subtract(Math.abs(value), normalizedUnit);

      const readableFormat = FORMAT_MAP[normalizedUnit];

      return JSON.stringify({
        value,
        unit: normalizedUnit,
        date: target.format('YYYY-MM-DD'),
        time: target.format('HH:mm:ss'),
        datetime: target.format('YYYY-MM-DD HH:mm:ss'),
        dateReadable: target.format(readableFormat),
        dayOfWeekCN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][target.day()],
        timestamp: target.valueOf(),
        isoString: target.toISOString(),
      });
    } catch (err: any) {
      console.error('[skill] get_date error:', err.message);
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: 'get_date',
    description:
      'Calculate a date/time by offset from now. value is the offset amount (negative = past, positive = future, 0 = now). unit is the time unit. Always call this first before searching for time-sensitive information like weather, news, etc.',
    schema: z.object({
      value: z.number().describe(
        'Offset from current time. 0 = now/today, 1 = next unit, -1 = previous unit, -3 = 3 units ago. Examples: tomorrow → value:1 unit:day, yesterday → value:-1 unit:day, 3 days ago → value:-3 unit:day, next week → value:1 unit:week',
      ),
      unit: z.string().describe(
        'Time unit: "year"(年), "month"(月), "week"(周), "day"(天/日), "hour"(小时/时), "minute"(分钟/分), "second"(秒)',
      ),
    }),
  },
);
