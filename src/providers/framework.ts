import { createProviderPlan } from "../provider-plans.js";
import type {
  ExecutionSettings,
  ProviderContext,
  ProviderId,
  ProviderPlan,
  ProviderRequest,
  ProviderResult,
  Tool,
} from "../types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

type Handler<TConfig, TTool extends Tool> = {
  execute: (
    request: ProviderRequest<TTool>,
    config: TConfig,
    context: ProviderContext,
  ) => Promise<ProviderResult<TTool>>;
};

export interface ProviderCapabilityHandlers<TConfig> {
  search?: Handler<TConfig, "search">;
  contents?: Handler<TConfig, "contents">;
  answer?: Handler<TConfig, "answer">;
  research?: Handler<TConfig, "research">;
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
  providerId: ProviderId;
  providerLabel: string;
  handlers: ProviderCapabilityHandlers<TConfig>;
  resolvePlanConfig?: (config: TConfig) => ConfigWithSettings;
}): ProviderPlan | null {
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

function buildPlan<TConfig, TTool extends Tool>({
  request,
  config,
  providerId,
  providerLabel,
  planConfig,
  handler,
}: {
  request: ProviderRequest<TTool>;
  config: TConfig;
  providerId: ProviderId;
  providerLabel: string;
  planConfig: ConfigWithSettings;
  handler: Handler<TConfig, TTool> | undefined;
}): ProviderPlan<TTool> | null {
  if (!handler) {
    return null;
  }

  return createProviderPlan<TTool>({
    config: planConfig,
    capability: request.capability as TTool,
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
