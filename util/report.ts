/**
 * Output shaped for an agent to act on, not for a human to admire.
 *
 * The rules that matter downstream: one record per line, a header naming every
 * field, a stable field order, no wrapped or padded text, and an explicit
 * `next:` line so the reader knows what command to run with the IDs it just
 * got. Everything above the table is `key: value` context.
 */

/** Pipe is the field separator, so it must never appear inside a field. */
export function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v).replace(/[|\r\n]+/g, " ").trim() || "-";
}

export function table(
  columns: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  return [
    columns.join("|"),
    ...rows.map((r) => r.map(cell).join("|")),
  ].join("\n");
}

/** Local wall-clock plus UTC, so "open now" is never ambiguous. */
export function nowLine(timeZone = "Asia/Jakarta"): string {
  const local = new Date().toLocaleString("sv-SE", { timeZone });
  return `now: ${local} ${timeZone} (${new Date().toISOString()})`;
}

export function header(title: string, fields: Record<string, string>): string {
  return [
    `# ${title}`,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
}
