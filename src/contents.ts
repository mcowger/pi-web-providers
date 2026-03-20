import type { ProviderId } from "./types.js";

export type TextContent = { text: string };
export type MarkdownContent = { markdown: string };
export type StructuredContent = Record<string, unknown>;

export type Content = TextContent | MarkdownContent | StructuredContent;

export interface ContentsAnswer {
  url: string;
  content?: Content;
  error?: string;
}

export interface ContentsResponse {
  provider: ProviderId;
  answers: ContentsAnswer[];
}

export function renderContent(content: Content | undefined): string {
  if (!content) {
    return "";
  }

  if (isTextContent(content)) {
    return content.text.trim();
  }

  if (isMarkdownContent(content)) {
    return content.markdown.trim();
  }

  return JSON.stringify(content, null, 2).trim();
}

export function renderContentsAnswer(
  answer: ContentsAnswer,
  index?: number,
): string {
  const heading =
    answer.error !== undefined
      ? `Error: ${answer.url || "Untitled"}`
      : answer.url || "Untitled";
  const lines = [
    `${index === undefined ? "" : `${index + 1}. `}${heading}`.trim(),
  ];

  const body =
    answer.error !== undefined
      ? answer.error.trim()
      : renderContent(answer.content);
  if (body) {
    for (const line of body.split("\n")) {
      lines.push(`   ${line}`);
    }
  }

  return lines.join("\n").trimEnd();
}

export function renderContentsAnswers(answers: ContentsAnswer[]): string {
  if (answers.length === 0) {
    return "No contents found.";
  }

  return (
    answers
      .map((answer, index) => renderContentsAnswer(answer, index))
      .join("\n\n")
      .trim() || "No contents found."
  );
}

export function asStructuredContent(
  value: unknown,
): StructuredContent | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  return value;
}

export function toContent(value: unknown): Content | undefined {
  if (typeof value === "string") {
    return { text: value };
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return { text: String(value) };
  }

  return asStructuredContent(value);
}

export function isTextContent(value: unknown): value is TextContent {
  return (
    isPlainObject(value) &&
    typeof value.text === "string" &&
    Object.keys(value).length === 1
  );
}

export function isMarkdownContent(value: unknown): value is MarkdownContent {
  return (
    isPlainObject(value) &&
    typeof value.markdown === "string" &&
    Object.keys(value).length === 1
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
