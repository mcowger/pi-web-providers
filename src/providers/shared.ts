import type { JsonObject } from "../types.js";

export function trimSnippet(
  input: string | undefined,
  maxLength = 300,
): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function asJsonObject(
  value: JsonObject | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
