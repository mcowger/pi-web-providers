import type {
  ExecutionSettings,
  ProviderPlan,
  ProviderPlanTraits,
} from "./types.js";

interface ConfigWithSettings {
  settings?: ExecutionSettings;
}

export function createProviderPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<ProviderPlan<TResult>, "traits"> & {
  config: ConfigWithSettings;
  traits?: Omit<ProviderPlanTraits, "settings">;
}): ProviderPlan<TResult> {
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
