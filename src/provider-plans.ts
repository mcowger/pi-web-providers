import type {
  ExecutionSettings,
  ProviderPlan,
  ProviderPlanTraits,
  Tool,
} from "./types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

export function createProviderPlan<TTool extends Tool>({
  config,
  traits,
  ...plan
}: Omit<ProviderPlan<TTool>, "traits"> & {
  config: ConfigWithSettings;
  traits?: Omit<ProviderPlanTraits, "settings">;
}): ProviderPlan<TTool> {
  const builtTraits = buildTraits(config.settings, traits);

  return {
    ...plan,
    ...(builtTraits ? { traits: builtTraits } : {}),
  };
}

function buildTraits(
  settings: ExecutionSettings | undefined,
  traits: Omit<ProviderPlanTraits, "settings"> | undefined,
): ProviderPlanTraits | undefined {
  const builtTraits: ProviderPlanTraits = {
    ...(settings ? { settings } : {}),
    ...(traits ?? {}),
  };

  return Object.keys(builtTraits).length > 0 ? builtTraits : undefined;
}
