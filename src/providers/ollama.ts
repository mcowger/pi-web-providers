import { type TObject, Type } from "@sinclair/typebox";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Ollama,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  Tool,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

const DEFAULT_SEARCH_URL = "https://ollama.com/api/web_search";
const DEFAULT_FETCH_URL = "https://ollama.com/api/web_fetch";

const ollamaSearchOptionsSchema = Type.Object(
  {
    max_results: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 10,
        description: "Maximum number of search results to return (1–10).",
      }),
    ),
  },
  { description: "Ollama search options." },
);

const ollamaFetchOptionsSchema = Type.Object(
  {},
  { description: "Ollama fetch options." },
);

export const ollamaAdapter: ProviderAdapter<Ollama> & {
  search(
    query: string,
    maxResults: number,
    config: Ollama,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Ollama,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
} = {
  id: "ollama",
  label: "Ollama",
  docsUrl: "https://docs.ollama.com/web-search",
  tools: ["search", "contents"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return ollamaSearchOptionsSchema;
      case "contents":
        return ollamaFetchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Ollama {
    return {
      apiKey: "OLLAMA_API_KEY",
      options: {},
    };
  },

  getConfigForCapability(capability: Tool, config: Ollama): unknown {
    switch (capability) {
      case "search":
        return {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          options: config.options?.search,
          settings: config.settings,
        };
      case "contents":
        return {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          options: config.options?.fetch,
          settings: config.settings,
        };
      default:
        return config;
    }
  },

  getCapabilityStatus(config: Ollama | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Ollama) {
    return buildProviderPlan({
      request,
      config,
      providerId: ollamaAdapter.id,
      providerLabel: ollamaAdapter.label,
      handlers: {
        search: {
          execute: (searchRequest, providerConfig: Ollama, context) =>
            ollamaAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        contents: {
          execute: (contentsRequest, providerConfig: Ollama, context) =>
            ollamaAdapter.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        },
      },
    });
  },

  async search(
    query: string,
    maxResults: number,
    config: Ollama,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.search)) ?? {};
    const runtimeOptions = stripLocalExecutionOptions(asJsonObject(options));
    const providerOptions = { ...defaults, ...(runtimeOptions ?? {}) };

    const searchUrl = resolveSearchUrl(config.baseUrl);

    const response = await fetch(searchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: clampMaxResults(maxResults),
        ...providerOptions,
      }),
      signal: context.signal,
    });

    if (!response.ok) {
      throw new Error(await buildHttpError(response));
    }

    const data = (await response.json()) as OllamaSearchResponse;
    const results = data.results ?? [];

    return {
      provider: ollamaAdapter.id,
      results: results.slice(0, maxResults).map((result) => ({
        title: String(result.title ?? result.url ?? "Untitled"),
        url: String(result.url ?? ""),
        snippet: trimSnippet(result.content),
      })),
    };
  },

  async contents(
    urls: string[],
    config: Ollama,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    const fetchUrl = resolveFetchUrl(config.baseUrl);
    const answers: ContentsResponse["answers"] = [];

    for (const url of urls) {
      try {
        const response = await fetch(fetchUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url }),
          signal: context.signal,
        });

        if (!response.ok) {
          answers.push({
            url,
            error: `Ollama fetch failed: ${response.status} ${response.statusText}`,
          });
          continue;
        }

        const data = (await response.json()) as OllamaFetchResponse;
        answers.push({
          url,
          content: normalizeContentText(data.content),
          metadata: {
            ...(data.title ? { title: data.title } : {}),
            ...(Array.isArray(data.links) && data.links.length > 0
              ? { links: data.links }
              : {}),
          },
        });
      } catch (error) {
        answers.push({
          url,
          error: (error as Error).message,
        });
      }
    }

    return {
      provider: ollamaAdapter.id,
      answers,
    };
  },
};

interface OllamaSearchResult {
  title?: string;
  url?: string;
  content?: string;
}

interface OllamaSearchResponse {
  results?: OllamaSearchResult[];
}

interface OllamaFetchResponse {
  title?: string;
  content?: string;
  links?: string[];
}

function resolveSearchUrl(baseUrl: string | undefined): string {
  const base = (resolveConfigValue(baseUrl) ?? DEFAULT_SEARCH_URL).replace(
    /\/+$/,
    "",
  );
  return base;
}

function resolveFetchUrl(baseUrl: string | undefined): string {
  const base = (resolveConfigValue(baseUrl) ?? DEFAULT_FETCH_URL).replace(
    /\/+$/,
    "",
  );
  return base;
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(10, Math.trunc(value || 0)));
}

async function buildHttpError(response: Response): Promise<string> {
  const detail = await readErrorDetail(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return detail
    ? `Ollama API request failed (${status}): ${detail}`
    : `Ollama API request failed (${status}).`;
}

async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const detail =
        readString(record.message) ??
        readString(record.error) ??
        readString(record.detail);
      if (detail) {
        return detail;
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function normalizeContentText(input: string | undefined): string {
  const text = (input ?? "").replace(/\r/g, "").trim();
  if (!text) {
    return "";
  }

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
