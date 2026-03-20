import { getMappedProviderForTool } from "./provider-tools.js";
import { ADAPTERS_BY_ID } from "./providers/index.js";
import type {
  AnyProvider,
  ExecutionSettings,
  Tool,
  ProviderId,
  ProviderAdapter,
  WebProviders,
} from "./types.js";

export function supportsTool(
  provider: ProviderAdapter<unknown>,
  tool: Tool,
): boolean {
  return provider.tools.includes(tool);
}

export function resolveSearchProvider(
  config: WebProviders,
  cwd: string,
  explicit?: ProviderId,
) {
  return resolveProviderForTool(config, cwd, "search", explicit);
}

export function getEffectiveProviderConfig(
  config: WebProviders,
  providerId: ProviderId,
): AnyProvider | undefined {
  const providerConfig = config.providers?.[providerId] as
    | AnyProvider
    | undefined;
  if (!providerConfig) {
    return undefined;
  }

  const mergedSettings = mergeSettings(
    config.settings,
    providerConfig.settings,
  );
  if (!mergedSettings) {
    return providerConfig;
  }

  return {
    ...providerConfig,
    settings: mergedSettings,
  } as AnyProvider;
}

function mergeSettings(
  shared: WebProviders["settings"],
  provider: ExecutionSettings | undefined,
): ExecutionSettings | undefined {
  const merged: ExecutionSettings = {
    requestTimeoutMs: provider?.requestTimeoutMs ?? shared?.requestTimeoutMs,
    retryCount: provider?.retryCount ?? shared?.retryCount,
    retryDelayMs: provider?.retryDelayMs ?? shared?.retryDelayMs,
    researchPollIntervalMs:
      provider?.researchPollIntervalMs ?? shared?.researchPollIntervalMs,
    researchTimeoutMs: provider?.researchTimeoutMs ?? shared?.researchTimeoutMs,
    researchMaxConsecutivePollErrors:
      provider?.researchMaxConsecutivePollErrors ??
      shared?.researchMaxConsecutivePollErrors,
  };

  return Object.values(merged).some((value) => value !== undefined)
    ? merged
    : undefined;
}

export function getMappedProviderIdForTool(
  config: WebProviders,
  tool: Tool,
): ProviderId | undefined {
  const providerId = getMappedProviderForTool(config, tool);
  return providerId === null ? undefined : providerId;
}

export function resolveProviderForTool(
  config: WebProviders,
  cwd: string,
  tool: Tool,
  explicit?: ProviderId,
) {
  const providerId = explicit ?? getMappedProviderIdForTool(config, tool);
  if (!providerId) {
    throw new Error(
      `No provider is configured for '${tool}'. Run /web-providers to configure tool mappings.`,
    );
  }

  const provider = ADAPTERS_BY_ID[providerId];
  if (!supportsTool(provider, tool)) {
    throw new Error(`Provider '${providerId}' does not support '${tool}'.`);
  }

  const providerConfig = getEffectiveProviderConfig(config, providerId);
  const status = provider.getStatus(providerConfig as never, cwd, tool);
  if (!status.available) {
    throw new Error(
      `Provider '${providerId}' is not available: ${status.summary}.`,
    );
  }

  return provider;
}
