import { LinkupClient } from "linkup-sdk";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Linkup,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { getApiKeyStatus, trimSnippet } from "./shared.js";

type LinkupAdapter = ProviderAdapter<Linkup> & {
  search(
    query: string,
    maxResults: number,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
};

export const linkupAdapter: LinkupAdapter = {
  id: "linkup",
  label: "Linkup",
  docsUrl: "https://docs.linkup.so/pages/sdk/js/js",
  tools: ["search", "contents"] as const,

  createTemplate(): Linkup {
    return {
      apiKey: "LINKUP_API_KEY",
    };
  },

  getCapabilityStatus(config: Linkup | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Linkup) {
    return buildProviderPlan({
      request,
      config,
      providerId: linkupAdapter.id,
      providerLabel: linkupAdapter.label,
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Linkup,
            context: ProviderContext,
          ) =>
            linkupAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        contents: {
          execute: (
            contentsRequest,
            providerConfig: Linkup,
            context: ProviderContext,
          ) =>
            linkupAdapter.contents(
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
    config: Linkup,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const response = (await client.search({
      query,
      depth: "standard",
      outputType: "searchResults",
      maxResults,
    })) as { results?: unknown[] };

    return {
      provider: linkupAdapter.id,
      results: (response.results ?? [])
        .map(toSearchResult)
        .filter((result): result is SearchResult => result !== null)
        .slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Linkup,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);

    return {
      provider: linkupAdapter.id,
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const response = (await client.fetch({ url })) as {
              markdown?: unknown;
            };

            return typeof response.markdown === "string" && response.markdown
              ? {
                  url,
                  content: response.markdown,
                }
              : {
                  url,
                  error: "No content returned for this URL.",
                };
          } catch (error) {
            return {
              url,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      ),
    };
  },
};

function createClient(config: Linkup): LinkupClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new LinkupClient({
    apiKey,
    baseUrl: resolveConfigValue(config.baseUrl),
  });
}

function toSearchResult(value: unknown): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const url = readString(entry.url) ?? "";
  const title = readString(entry.name) ?? (url || "Untitled");
  const type = readString(entry.type);
  const favicon = readString(entry.favicon);
  const snippet =
    type === "text" ? trimSnippet(readString(entry.content) ?? "") : "";
  const metadata = {
    ...(type ? { type } : {}),
    ...(favicon ? { favicon } : {}),
  };

  return {
    title,
    url,
    snippet,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
