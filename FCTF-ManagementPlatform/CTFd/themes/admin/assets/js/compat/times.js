import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import utc from "dayjs/plugin/utc";
import $ from "jquery";

dayjs.extend(advancedFormat);
dayjs.extend(utc);

const parseAsLocal = rawValue => {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  const raw = String(rawValue).trim();
  if (!raw) {
    return null;
  }

  // Epoch timestamps are absolute instants.
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      const millis = raw.length <= 10 ? num * 1000 : num;
      return dayjs(millis);
    }
  }

  const hasExplicitTimezone = /(?:Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)$/i.test(raw);
  const baseCandidates = [raw, raw.replace(" ", "T")];
  const candidates = baseCandidates.flatMap(candidate => [
    candidate,
    candidate.replace(/(\.\d{3})\d+/, "$1"),
  ]);

  for (const candidate of candidates) {
    const parsed = hasExplicitTimezone ? dayjs(candidate) : dayjs.utc(candidate);
    if (parsed.isValid()) {
      return parsed.local();
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return dayjs(fallback);
  }

  return null;
};

export default function renderTimes() {
  $("[data-time]").each((i, elem) => {
    const $elem = $(elem);
    const rawTime = $elem.attr("data-time");
    const format = $elem.attr("data-time-format") || "MMMM Do, h:mm:ss A";
    const parsed = parseAsLocal(rawTime);
    elem.innerText = parsed ? parsed.format(format) : (rawTime || "");
  });
}
