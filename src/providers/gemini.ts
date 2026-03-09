import { GoogleGenAI } from "@google/genai";
import { resolveConfigValue } from "../config.js";
import type {
  GeminiProviderConfig,
  ProviderContext,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { trimSnippet } from "./shared.js";

const DEFAULT_SEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
const DEFAULT_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";
const DEFAULT_POLL_INTERVAL_MS = 3000;

export class GeminiProvider implements WebProvider<GeminiProviderConfig> {
  readonly id = "gemini";
  readonly label = "Gemini";
  readonly docsUrl = "https://github.com/googleapis/js-genai";

  createTemplate(): GeminiProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        answer: true,
        research: true,
      },
      apiKey: "GOOGLE_API_KEY",
      defaults: {
        searchModel: DEFAULT_SEARCH_MODEL,
        answerModel: DEFAULT_ANSWER_MODEL,
        researchAgent: DEFAULT_RESEARCH_AGENT,
      },
    };
  }

  getStatus(config: GeminiProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }

  async search(
    query: string,
    maxResults: number,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const ai = this.createClient(config);
    const model = config.defaults?.searchModel ?? DEFAULT_SEARCH_MODEL;

    context.onProgress?.(`Searching Gemini for: ${query}`);
    const interaction = await ai.interactions.create({
      model,
      input: query,
      tools: [{ type: "google_search" }],
      generation_config: {
        tool_choice: "any",
      },
    });

    const results = extractGoogleSearchResults(interaction.outputs)
      .slice(0, maxResults)
      .map((result) => ({
        title: result.title ?? result.url ?? "Untitled",
        url: result.url ?? "",
        snippet: trimSnippet(result.rendered_content ?? ""),
      }));

    return {
      provider: this.id,
      results,
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);
    const model = config.defaults?.answerModel ?? DEFAULT_ANSWER_MODEL;

    context.onProgress?.(`Getting Gemini answer for: ${query}`);
    const response = await ai.models.generateContent({
      model,
      contents: query,
      config: {
        ...(options ?? {}),
        tools: [{ googleSearch: {} }],
      },
    });

    const lines: string[] = [];
    lines.push(response.text?.trim() || "No answer returned.");

    const sources = extractGroundingSources(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks,
    );
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Gemini with ${sources.length} source(s)`,
      itemCount: sources.length,
    };
  }

  async research(
    input: string,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);
    const agent = config.defaults?.researchAgent ?? DEFAULT_RESEARCH_AGENT;
    const pollIntervalMs = getPollInterval(options);
    const requestOptions = stripPollIntervalOption(options);

    context.onProgress?.("Starting Gemini deep research");
    const initialInteraction = await ai.interactions.create({
      ...requestOptions,
      input,
      agent,
      background: true,
    });

    context.onProgress?.(`Gemini research started: ${initialInteraction.id}`);

    while (true) {
      if (context.signal?.aborted) {
        throw new Error("Gemini research aborted.");
      }

      const interaction = await ai.interactions.get(initialInteraction.id);
      context.onProgress?.(`Gemini research status: ${interaction.status}`);

      if (interaction.status === "completed") {
        const text = formatInteractionOutputs(interaction.outputs);
        return {
          provider: this.id,
          text: text || "Gemini research completed without textual output.",
          summary: "Research via Gemini",
        };
      }

      if (interaction.status === "failed" || interaction.status === "cancelled") {
        throw new Error(`Gemini research ${interaction.status}.`);
      }

      await sleep(pollIntervalMs, context.signal);
    }
  }

  private createClient(config: GeminiProviderConfig): GoogleGenAI {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Gemini is missing an API key.");
    }

    return new GoogleGenAI({
      apiKey,
      apiVersion: config.defaults?.apiVersion,
    });
  }
}

function extractGoogleSearchResults(
  outputs: unknown,
): Array<{ title?: string; url?: string; rendered_content?: string }> {
  const results: Array<{ title?: string; url?: string; rendered_content?: string }> = [];
  if (!Array.isArray(outputs)) {
    return results;
  }

  for (const output of outputs) {
    if (typeof output !== "object" || output === null) {
      continue;
    }
    const content = output as { type?: unknown; result?: unknown };
    if (content.type !== "google_search_result") {
      continue;
    }
    const items = Array.isArray(content.result) ? content.result : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      results.push({
        title: typeof record.title === "string" ? record.title : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        rendered_content:
          typeof record.rendered_content === "string"
            ? record.rendered_content
            : undefined,
      });
    }
  }
  return results;
}

function extractGroundingSources(
  chunks: unknown,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];

  if (!Array.isArray(chunks)) {
    return sources;
  }

  for (const chunk of chunks) {
    const web =
      typeof chunk === "object" &&
      chunk !== null &&
      "web" in chunk &&
      typeof chunk.web === "object" &&
      chunk.web !== null
        ? (chunk.web as Record<string, unknown>)
        : undefined;
    if (!web) continue;

    const url = typeof web.uri === "string" ? web.uri : undefined;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    sources.push({
      title: typeof web.title === "string" ? web.title : url,
      url,
    });
  }

  return sources;
}

function formatInteractionOutputs(
  outputs: unknown,
): string {
  const lines: string[] = [];

  if (!Array.isArray(outputs)) {
    return "";
  }

  for (const output of outputs) {
    if (
      typeof output === "object" &&
      output !== null &&
      "type" in output &&
      output.type === "text" &&
      "text" in output &&
      typeof output.text === "string"
    ) {
      const text = output.text.trim();
      if (text) {
        lines.push(text);
      }
    }
  }

  return lines.join("\n\n").trim();
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    throw new Error("Operation aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Operation aborted."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getPollInterval(options: Record<string, unknown> | undefined): number {
  const raw = options?.pollIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1000) {
    return Math.trunc(raw);
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

function stripPollIntervalOption(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options || !Object.hasOwn(options, "pollIntervalMs")) {
    return options;
  }

  const { pollIntervalMs: _ignored, ...rest } = options;
  return rest;
}
