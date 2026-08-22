const BR_TIME_ZONE = 'America/Sao_Paulo';

function brParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
  };
}

export function brDateKey(date = new Date()): string {
  const { year, month, day } = brParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatBrDate(date: Date): string {
  const { year, month, day } = brParts(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function brDayWindow(date = new Date()): { start: Date; endInclusive: Date } {
  const { year, month, day } = brParts(date);
  const start = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
  const endInclusive = new Date(start);
  endInclusive.setUTCDate(endInclusive.getUTCDate() + 1);
  endInclusive.setUTCMilliseconds(endInclusive.getUTCMilliseconds() - 1);
  return { start, endInclusive };
}
