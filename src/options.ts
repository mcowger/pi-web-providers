import type { TObject } from "@sinclair/typebox";
import { type Static, Type } from "@sinclair/typebox";
import type { Tool } from "./types.js";
import { PROVIDER_IDS } from "./types.js";

export const providerOptionsSchema = Type.Object(
  {},
  { additionalProperties: true },
);
export type ProviderOptions = Record<string, unknown>;

const runtimeOptionFields = {
  requestTimeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Maximum time in milliseconds to wait for a single provider request.",
    }),
  ),
  retryCount: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Number of times to retry transient failures.",
    }),
  ),
  retryDelayMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Initial delay in milliseconds before retrying. Later retries back off automatically.",
    }),
  ),
};

export const runtimeOptionsSchema = Type.Object(runtimeOptionFields, {
  additionalProperties: false,
  description: "Local runtime controls for this tool call.",
});
export type RuntimeOptions = Static<typeof runtimeOptionsSchema>;

export const searchPrefetchOptionsSchema = Type.Object(
  {
    provider: Type.Optional(
      Type.Union([...PROVIDER_IDS.map((id) => Type.Literal(id)), Type.Null()], {
        description:
          "Contents-capable provider to prefetch search result URLs. Set to enable prefetch.",
      }),
    ),
    maxUrls: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum number of search result URLs to prefetch.",
      }),
    ),
    ttlMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "How long prefetched contents stay reusable in the local cache, in milliseconds.",
      }),
    ),
    contentsOptions: Type.Optional(
      Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            "Options to pass to the contents provider during prefetch.",
        },
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Background contents prefetch for search result URLs. Only runs when provider is set.",
  },
);
export type SearchPrefetchOptions = Static<typeof searchPrefetchOptionsSchema>;

export const searchRuntimeOptionsSchema = Type.Object(
  {
    ...runtimeOptionFields,
    prefetch: Type.Optional(searchPrefetchOptionsSchema),
  },
  {
    additionalProperties: false,
    description: "Local runtime controls for search.",
  },
);
export type SearchRuntimeOptions = Static<typeof searchRuntimeOptionsSchema>;

export const researchRuntimeOptionsSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description:
      "Research runs asynchronously and does not accept runtime overrides.",
  },
);
export type ResearchRuntimeOptions = Static<
  typeof researchRuntimeOptionsSchema
>;

export interface ToolRuntimeOptionsMap {
  search: SearchRuntimeOptions;
  contents: RuntimeOptions;
  answer: RuntimeOptions;
  research: ResearchRuntimeOptions;
}

export type RuntimeOptionsFor<TTool extends Tool> =
  ToolRuntimeOptionsMap[TTool];

export interface ToolOptionsFor<
  TTool extends Tool,
  TProviderOptions extends ProviderOptions = ProviderOptions,
> {
  provider?: TProviderOptions;
  runtime?: RuntimeOptionsFor<TTool>;
}

export function buildToolOptionsSchema(
  capability: Tool,
  providerSchema?: TObject,
) {
  const properties: Record<string, ReturnType<typeof Type.Optional>> = {
    runtime: Type.Optional(getRuntimeOptionsSchema(capability)),
  };

  if (providerSchema) {
    properties.provider = Type.Optional(providerSchema);
  }

  return Type.Object(properties, {
    additionalProperties: false,
    description:
      "Options for this tool call split into provider-facing settings and local runtime controls.",
  });
}

function getRuntimeOptionsSchema(capability: Tool) {
  switch (capability) {
    case "search":
      return searchRuntimeOptionsSchema;
    case "contents":
    case "answer":
      return runtimeOptionsSchema;
    case "research":
      return researchRuntimeOptionsSchema;
  }
}

export type AnyToolOptions = {
  provider?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
};

export function getToolOptionsProvider(
  options: AnyToolOptions | undefined,
): Record<string, unknown> | undefined {
  return options?.provider;
}

export function getToolOptionsRuntime(
  options: AnyToolOptions | undefined,
): Record<string, unknown> | undefined {
  return options?.runtime;
}
