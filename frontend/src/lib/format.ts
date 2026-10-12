import i18n from '@/i18n';

function locale() {
  return i18n.language === 'tr' ? 'tr-TR' : 'en-GB';
}

export function formatDateTime(iso: string | undefined | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatRelative(iso: string | undefined | null, now = Date.now()) {
  if (!iso) return '';
  const date = new Date(iso).getTime();
  if (Number.isNaN(date)) return iso;
  const seconds = Math.round((date - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(Math.round(seconds / 86400), 'day');
  return formatDateTime(iso);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(locale()).format(value);
}

/** "4:05" for a countdown in seconds. */
export function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Only same-origin paths are accepted as a post-login target (no open redirect). */
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}
