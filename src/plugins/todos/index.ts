import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { today } from "../../core/utils.js";
import {
  loadStore, saveStore, newId, applyCheck, applyUncheck, applyDelete, applyMove,
  demotePastMusts, catchUpRecurring, computeMustFrom, type TodoItem, type RecurrenceRule,
} from "./store.js";
import { buildTodoDisplay, resolveSelector } from "./display.js";

/**
 * To-dos. One JSON store (data/todos.json) is the only source of truth; the
 * per-day view is derived from it on every read, so nothing can drift.
 * Unfinished items roll forward to today on their own; one-off "musts" that
 * lapse are demoted to flex and tagged "(missed MM/DD)"; recurring items
 * advance a cycle when checked. Everything is addressed by id.
 */

const TIME_ZONE = process.env.TZ_NAME || "America/New_York";

const recurrenceSchema = z.object({
  rule: z.enum(["daily", "weekly", "monthly"]),
  weekday: z.number().min(0).max(6).optional().describe("0=Sun..6=Sat, weekly only"),
  day_of_month: z.number().min(1).max(31).optional().describe("monthly only"),
  must_offset_days: z.number().min(0).optional().describe("days after show_from the item becomes must (0 = same day)"),
});

async function viewFor(startDate: string, endDate = startDate) {
  const t = today();
  await demotePastMusts(t);
  await catchUpRecurring(t);
  const store = await loadStore();
  return buildTodoDisplay(store.items, { startDate, endDate, today: t, timeZone: TIME_ZONE });
}

function render(days: ReturnType<typeof buildTodoDisplay>): string {
  const nonEmpty = days.filter((d) => d.items.length);
  if (!nonEmpty.length) return "No to-dos.";
  return nonEmpty.map((d) =>
    `## ${d.date} ${d.dayLabel}\n` + d.items.map((r, i) =>
      `${i}. ${r.checked ? "[x]" : "[ ]"} ${r.text}${r.annotation ? " " + r.annotation : ""}${r.time ? " @" + r.time : ""}${r.must ? " #must" : ""}${r.recurrence ? " #" + r.recurrence : ""}${r.checked && r.resolution ? " — " + r.resolution : ""}  (id: ${r.id})`,
    ).join("\n"),
  ).join("\n\n");
}

export function register(server: McpServer): void {
  server.tool(
    "todo_get",
    "To-dos for a date or range (default today). Past days show what got done; today shows every open item that has rolled forward plus today's completions; future days show only items scheduled that day. Rows carry their id.",
    {
      date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
      end_date: z.string().optional().describe("inclusive end of range"),
    },
    async ({ date, end_date }) => {
      const start = date || today();
      return { content: [{ type: "text", text: render(await viewFor(start, end_date || start)) }] };
    },
  );

  server.tool(
    "todo_add",
    "Add a to-do. must=true makes it a must-do on that date; recurrence makes it a repeating seed.",
    {
      date: z.string().describe("YYYY-MM-DD the item should first show"),
      text: z.string().describe("Title"),
      must: z.boolean().optional().default(false),
      time: z.string().optional().describe("HH:MM local"),
      recurrence: recurrenceSchema.optional(),
    },
    async ({ date, text, must, time, recurrence }) => {
      const rec = recurrence as RecurrenceRule | undefined;
      const now = new Date().toISOString();
      const item: TodoItem = {
        id: newId(),
        title: text.trim(),
        status: "open",
        show_from: date,
        must_from: rec
          ? (rec.must_offset_days !== undefined ? computeMustFrom(date, rec.must_offset_days) : undefined)
          : (must ? date : undefined),
        time,
        recurrence: rec,
        created_at: now,
        updated_at: now,
      };
      const store = await loadStore();
      store.items.push(item);
      await saveStore(store);
      return { content: [{ type: "text", text: `Added: ${item.title} (${date}${item.must_from ? " #must" : ""}) (id: ${item.id})` }] };
    },
  );

  server.tool(
    "todo_check",
    "Check or uncheck a to-do shown on a date. Selector = index from todo_get, the id, or a unique title substring. Recurring items advance a cycle; checking a past date on a recurring item records a retroactive completion.",
    {
      date: z.string().describe("YYYY-MM-DD"),
      selector: z.string(),
      checked: z.boolean().default(true),
      resolution: z.string().optional().describe("Optional note on how it went"),
    },
    async ({ date, selector, checked, resolution }) => {
      const t = today();
      const rows = (await viewFor(date))[0].items;
      const row = resolveSelector(rows, selector);
      const store = await loadStore();

      if (!row) {
        if (date < t && !/^\d+$/.test(selector)) {
          const q = selector.toLowerCase().trim();
          const cands = store.items.filter((i) => i.status === "open" && i.recurrence && (i.id === selector || i.title.toLowerCase().includes(q)));
          if (cands.length === 1) {
            const it = cands[0];
            it.progress = (it.progress ?? []).filter((p) => p.date !== date);
            if (checked) it.progress.push({ date, note: "Completed (retroactive)" });
            it.updated_at = new Date().toISOString();
            await saveStore(store);
            return { content: [{ type: "text", text: `${checked ? "Checked (retroactive)" : "Unchecked"} for ${date}: ${it.title}` }] };
          }
        }
        return { content: [{ type: "text", text: `No unique match for "${selector}" on ${date}.\n${render([{ date, dayLabel: "", items: rows }])}` }], isError: true };
      }
      if (row.checked === checked) return { content: [{ type: "text", text: `Already ${checked ? "checked" : "unchecked"}: ${row.text}` }] };

      const idx = store.items.findIndex((i) => i.id === row.id);
      const it = store.items[idx];
      if (checked) store.items[idx] = applyCheck(it, t, date, resolution);
      else if (it.recurrence && date !== t) store.items[idx] = { ...it, progress: (it.progress ?? []).filter((p) => p.date !== date), updated_at: new Date().toISOString() };
      else store.items[idx] = applyUncheck(it, t);
      await saveStore(store);
      return { content: [{ type: "text", text: `${checked ? "Checked" : "Unchecked"}: ${row.text}` }] };
    },
  );

  server.tool(
    "todo_move",
    "Move an open to-do shown on one date to another date.",
    { from_date: z.string(), selector: z.string(), to_date: z.string() },
    async ({ from_date, selector, to_date }) => {
      const row = resolveSelector((await viewFor(from_date))[0].items, selector);
      if (!row) return { content: [{ type: "text", text: `No unique match for "${selector}" on ${from_date}.` }], isError: true };
      if (row.checked) return { content: [{ type: "text", text: `Can't move a completed item: ${row.text}` }], isError: true };
      const store = await loadStore();
      const idx = store.items.findIndex((i) => i.id === row.id);
      store.items[idx] = applyMove(store.items[idx], to_date);
      await saveStore(store);
      return { content: [{ type: "text", text: `Moved: ${row.text} → ${to_date}` }] };
    },
  );

  server.tool(
    "todo_delete",
    "Delete a to-do by id (soft delete; it disappears from every view).",
    { id: z.string() },
    async ({ id }) => {
      const store = await loadStore();
      const idx = store.items.findIndex((i) => i.id === id);
      if (idx === -1) return { content: [{ type: "text", text: `Not found: ${id}` }], isError: true };
      store.items[idx] = applyDelete(store.items[idx]);
      await saveStore(store);
      return { content: [{ type: "text", text: `Deleted: ${store.items[idx].title}` }] };
    },
  );
}
