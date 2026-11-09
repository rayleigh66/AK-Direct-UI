const ENGLISH_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const ENGLISH_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
  timeZone: 'UTC',
});

function parseDateValue(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? text.replace(' ', 'T')
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** English display for ISO date-only and ISO timestamp values. */
export function formatEnglishDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = parseDateValue(value);
  return date ? ENGLISH_DATE.format(date) : value;
}

/** English date/time display for internal timestamps; customer dates stay date-only. */
export function formatEnglishDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = parseDateValue(value);
  return date ? ENGLISH_DATE_TIME.format(date) : value;
}

/** Keep the backend ISO date-only contract while giving the field a value. */
export function toIsoDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
