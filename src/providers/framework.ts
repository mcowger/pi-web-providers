import type { ContentsResponse } from "../contents.js";
import { createProviderPlan } from "../provider-plans.js";
import type {
  AnswerRequest,
  ContentsRequest,
  ExecutionSettings,
  ProviderContext,
  ProviderPlan,
  ProviderRequest,
  ResearchRequest,
  SearchRequest,
  SearchResponse,
  ToolOutput,
} from "../types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

type Handler<
  TConfig,
  TRequest extends ProviderRequest,
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
> = {
  execute: (
    request: TRequest,
    config: TConfig,
    context: ProviderContext,
  ) => Promise<TResult>;
};

export interface ProviderCapabilityHandlers<TConfig> {
  search?: Handler<TConfig, SearchRequest, SearchResponse>;
  contents?: Handler<TConfig, ContentsRequest, ContentsResponse>;
  answer?: Handler<TConfig, AnswerRequest, ToolOutput>;
  research?: Handler<TConfig, ResearchRequest, ToolOutput>;
}

export function buildProviderPlan<TConfig>({
  request,
  config,
  providerId,
  providerLabel,
  handlers,
  resolvePlanConfig,
}: {
  request: ProviderRequest;
  config: TConfig;
  providerId: ProviderPlan<unknown>["providerId"];
  providerLabel: string;
  handlers: ProviderCapabilityHandlers<TConfig>;
  resolvePlanConfig?: (config: TConfig) => ConfigWithSettings;
}): ProviderPlan<SearchResponse | ContentsResponse | ToolOutput> | null {
  const planConfig = resolvePlanConfig?.(config) ?? asPlanConfig(config);

  switch (request.capability) {
    case "search":
      return buildPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.search,
      });
    case "contents":
      return buildPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.contents,
      });
    case "answer":
      return buildPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.answer,
      });
    case "research":
      return buildPlan({
        request,
        config,
        providerId,
        providerLabel,
        planConfig,
        handler: handlers.research,
      });
  }
}

function buildPlan<
  TConfig,
  TRequest extends ProviderRequest,
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>({
  request,
  config,
  providerId,
  providerLabel,
  planConfig,
  handler,
}: {
  request: TRequest;
  config: TConfig;
  providerId: ProviderPlan<unknown>["providerId"];
  providerLabel: string;
  planConfig: ConfigWithSettings;
  handler: Handler<TConfig, TRequest, TResult> | undefined;
}): ProviderPlan<TResult> | null {
  if (!handler) {
    return null;
  }

  return createProviderPlan({
    config: planConfig,
    capability: request.capability,
    providerId,
    providerLabel,
    execute: (context: ProviderContext) =>
      handler.execute(request, config, context),
  });
}

function asPlanConfig<TConfig>(config: TConfig): ConfigWithSettings {
  if (typeof config === "object" && config !== null && "settings" in config) {
    return config as ConfigWithSettings;
  }
  return {};
}
