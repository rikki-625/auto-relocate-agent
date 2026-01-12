function parseOffset(offset: string): string | null {
  const match = offset.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const sign = hours >= 0 ? "+" : "-";
  const absHours = Math.abs(hours).toString().padStart(2, "0");
  const minutes = match[2] ? match[2].padStart(2, "0") : "00";

  return `${sign}${absHours}${minutes}`;
}

export function buildRunId(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset"
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  const offset = parseOffset(get("timeZoneName")) ?? "+0000";

  return `${year}${month}${day}_${hour}${minute}${second}${offset}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

