import { PROVIDER_MAP, PROVIDERS } from "./providers/index.js";
import type { ProviderId, WebProvidersConfig } from "./types.js";
import { isProviderToolEnabled, type ProviderConfigUnion, type ProviderToolId } from "./provider-tools.js";

export function resolveProviderChoice(
  config: WebProvidersConfig,
  explicit: ProviderId | undefined,
  cwd: string,
) {
  return resolveProviderForCapability(config, explicit, cwd, "search");
}

export function resolveProviderForCapability(
  config: WebProvidersConfig,
  explicit: ProviderId | undefined,
  cwd: string,
  capability: ProviderToolId,
) {
  if (explicit) {
    const provider = PROVIDER_MAP[explicit];
    if (typeof provider[capability] !== "function") {
      throw new Error(
        `Provider '${explicit}' does not support '${capability}'.`,
      );
    }
    if (
      !isProviderToolEnabled(
        explicit,
        config.providers?.[explicit] as ProviderConfigUnion | undefined,
        capability,
      )
    ) {
      throw new Error(
        `Provider '${explicit}' has '${capability}' disabled in config.`,
      );
    }
    const status = provider.getStatus(
      config.providers?.[explicit] as never,
      cwd,
    );
    if (!status.available) {
      throw new Error(
        `Provider '${explicit}' is not available: ${status.summary}.`,
      );
    }
    return provider;
  }

  for (const provider of PROVIDERS) {
    if (typeof provider[capability] !== "function") continue;
    const providerConfig = config.providers?.[provider.id];
    if (providerConfig?.enabled !== true) continue;
    if (
      !isProviderToolEnabled(
        provider.id,
        providerConfig as ProviderConfigUnion | undefined,
        capability,
      )
    ) {
      continue;
    }
    const status = provider.getStatus(providerConfig as never, cwd);
    if (status.available) return provider;
  }

  for (const provider of PROVIDERS) {
    if (typeof provider[capability] !== "function") continue;
    if (
      !isProviderToolEnabled(
        provider.id,
        config.providers?.[provider.id] as ProviderConfigUnion | undefined,
        capability,
      )
    ) {
      continue;
    }
    const status = provider.getStatus(
      config.providers?.[provider.id] as never,
      cwd,
    );
    if (status.available) return provider;
  }

  throw new Error(
    `No provider is configured for '${capability}'. Run /web-providers to create ~/.pi/agent/web-providers.json.`,
  );
}
