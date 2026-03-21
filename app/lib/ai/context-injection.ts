/**
 * Builds the runtime context string injected into the system prompt.
 * Contains current date, day, time, and user location.
 * Called once per request — never cached between requests.
 */
export function buildRuntimeContext(options?: {
  userCity?: string;
  userCountry?: string;
  userTimezone?: string;
}): string {
  const timezone =
    options?.userTimezone ||
    process.env.DEFAULT_USER_TIMEZONE ||
    "Asia/Kolkata";

  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const dayFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    weekday: "long",
  });

  const yearFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    year: "numeric",
  });

  const formattedDate = dateFormatter.format(now);
  const formattedTime = timeFormatter.format(now);
  const formattedDay  = dayFormatter.format(now);
  const formattedYear = yearFormatter.format(now);

  const city    = options?.userCity    || process.env.DEFAULT_USER_CITY    || "Jeypore";
  const country = options?.userCountry || process.env.DEFAULT_USER_COUNTRY || "India";

  return (
    `Today is ${formattedDate}.\n` +
    `Current day: ${formattedDay}.\n` +
    `Current time: ${formattedTime} (${timezone}).\n` +
    `Current year: ${formattedYear}.\n` +
    `User location: ${city}, ${country}.\n` +
    `\n` +
    `Use these values to answer any question about the current date, day, time, or year directly — ` +
    `do NOT search for them. For live data (prices, news, scores, events) still search as normal.\n` +
    `When composing search queries for news, videos, or current events, ` +
    `always append "${formattedYear}" or "today" to ensure freshest results.`
  );
}

/**
 * Returns true if the query is asking for the current date, day, time,
 * or year — and can be answered from injected runtime context.
 * These should NEVER trigger a web search.
 */
export function looksLikeDateTimeQuery(query: string): boolean {
  const raw = (query ?? "").trim().toLowerCase();
  if (!raw || raw.length > 60) return false;

  const patterns = [
    /^what('?s| is) (today'?s? |the )?(date|day|time|year|month)(\?)?$/i,
    /^what day (is it|is today)(\?)?$/i,
    /^what time is it(\?)?$/i,
    /^what('?s| is) the (current )?(date|day|time|year)(\?)?$/i,
    /^(today'?s? date|current date|current time|current day|current year)(\?)?$/i,
    /^(what|tell me) (the )?(date|day|time) (today|now|right now)(\?)?$/i,
  ];

  return patterns.some((p) => p.test(raw));
}
