export interface ContentsEntry {
  url: string;
  title?: string;
  body: string;
  summary?: string;
  status?: "ready" | "failed";
}
