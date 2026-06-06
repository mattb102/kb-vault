import { google } from "googleapis";
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";

const TOKEN_PATH = resolve("data/google-tokens.json");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

function makeClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl(): string {
  const client = makeClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
  });
}

export async function handleCallback(code: string): Promise<void> {
  const client = makeClient();
  const { tokens } = await client.getToken(code);
  await mkdir("data", { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function getAuthClient() {
  const client = makeClient();
  let tokens: any;
  try {
    tokens = JSON.parse(await readFile(TOKEN_PATH, "utf-8"));
  } catch {
    throw new Error("Google Calendar not authorized. Visit /calendar/auth to connect.");
  }
  client.setCredentials(tokens);
  // Auto-save refreshed tokens
  client.on("tokens", async (fresh) => {
    const merged = { ...tokens, ...fresh };
    await writeFile(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });
  return client;
}

export async function listUpcoming(days = 7): Promise<string> {
  const auth = await getAuthClient();
  const cal = google.calendar({ version: "v3", auth });

  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);

  // Fetch all calendars so subscribed work calendars are included
  const calListRes = await cal.calendarList.list();
  const calendars = calListRes.data.items || [];

  const allEvents: Array<{ event: any; calendarName: string }> = [];

  for (const calendar of calendars) {
    const res = await cal.events.list({
      calendarId: calendar.id!,
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    for (const event of res.data.items || []) {
      allEvents.push({ event, calendarName: calendar.summary || calendar.id! });
    }
  }

  // Sort all events by start time
  allEvents.sort((a, b) => {
    const aStart = a.event.start?.dateTime || a.event.start?.date || "";
    const bStart = b.event.start?.dateTime || b.event.start?.date || "";
    return aStart.localeCompare(bStart);
  });

  if (allEvents.length === 0) return `No events in the next ${days} days.`;

  return allEvents
    .map(({ event: e, calendarName }) => {
      const start = e.start?.dateTime || e.start?.date || "?";
      const startDate = new Date(start);
      const label = e.start?.dateTime
        ? startDate.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York", // VPS is UTC; render in Matt's tz
          })
        : startDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            timeZone: "America/New_York",
          });
      const loc = e.location ? ` @ ${e.location}` : "";
      return `• ${label} — **${e.summary || "(no title)"}**${loc} [${calendarName}]`;
    })
    .join("\n");
}

export async function scheduleEvent(
  title: string,
  start: string,
  durationMinutes = 60,
  description?: string,
  location?: string
): Promise<string> {
  const auth = await getAuthClient();
  const cal = google.calendar({ version: "v3", auth });

  const TIMEZONE = "America/New_York";
  // Parse as UTC to do arithmetic, then format back as a local datetime string
  // so Google interprets it in TIMEZONE rather than UTC.
  const startMs = new Date(start).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;
  const toLocalStr = (ms: number) => new Date(ms).toISOString().replace("Z", "");

  const res = await cal.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description,
      location,
      start: { dateTime: toLocalStr(startMs), timeZone: TIMEZONE },
      end: { dateTime: toLocalStr(endMs), timeZone: TIMEZONE },
    },
  });

  const link = res.data.htmlLink || "";
  // Display the input time as-is (it's already ET) by treating it as UTC for formatting
  const displayDate = new Date(start.includes("T") ? start + "Z" : start);
  return `Created: **${title}** on ${displayDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} ET (${durationMinutes} min)${link ? `\n${link}` : ""}`;
}
