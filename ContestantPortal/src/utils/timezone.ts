import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Setup dayjs plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Auto-detect user's timezone
const userTimezone = dayjs.tz.guess();

/**
 * Parse any timestamp (Unix seconds, Unix milliseconds, or ISO string) from UTC
 * and convert to user's local timezone using dayjs
 */
export const parseUTCToLocal = (input: string | number): dayjs.Dayjs => {
  let timestamp: number;
  
  if (typeof input === 'string') {
    // Try parsing as ISO string first
    const parsed = dayjs.utc(input);
    if (parsed.isValid()) {
      return parsed.tz(userTimezone);
    }
    // If string is numeric, treat as Unix timestamp
    timestamp = parseInt(input);
  } else {
    timestamp = input;
  }
  
  // If timestamp is in seconds (Unix timestamp < year 2286), convert to milliseconds
  if (timestamp < 10000000000) {
    timestamp = timestamp * 1000;
  }
  
  return dayjs.utc(timestamp).tz(userTimezone);
};

/**
 * Format a UTC timestamp to local timezone string
 */
export const formatUTCToLocal = (
  input: string | number,
  format: string = 'DD/MM/YYYY HH:mm:ss'
): string => {
  const localDate = parseUTCToLocal(input);
  return localDate.isValid() ? localDate.format(format) : 'Invalid date';
};

/**
 * Format UTC timestamp using browser's locale settings
 */
export const formatUTCToLocaleString = (
  input: string | number,
  options?: Intl.DateTimeFormatOptions
): string => {
  const localDate = parseUTCToLocal(input);
  if (!localDate.isValid()) return 'Invalid date';
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options,
  };
  
  return localDate.toDate().toLocaleString(undefined, defaultOptions);
};

/**
 * Get the current timezone name
 */
export const getTimezone = (): string => {
  return userTimezone;
};

/**
 * Export configured dayjs for advanced usage
 */
export { dayjs };
