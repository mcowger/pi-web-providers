import type {
  BackgroundResearchOperationPlan,
  ExecutionSettings,
  ProviderPlanTraits,
  SingleProviderOperationPlan,
} from "./types.js";

interface ConfigWithPolicy {
  settings?: ExecutionSettings;
}

// Silent foreground plans wait for a final result without surfacing partial
// provider output while the request is still running.
export function createSilentForegroundPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "settings">;
}): SingleProviderOperationPlan<TResult> {
  return buildSinglePlan("silent-foreground", config.settings, traits, plan);
}

// Streaming foreground plans can surface intermediate provider output, but the
// tool result is still only consumed once the call finishes.
export function createStreamingForegroundPlan<TResult>({
  config,
  traits,
  ...plan
}: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "settings">;
}): SingleProviderOperationPlan<TResult> {
  return buildSinglePlan("streaming-foreground", config.settings, traits, plan);
}

// Background research plans model providers that return a durable research job
// which pi can poll and later resume via `resumeId`.
export function createBackgroundResearchPlan({
  config,
  traits,
  ...plan
}: Omit<BackgroundResearchOperationPlan, "deliveryMode" | "traits"> & {
  config: ConfigWithPolicy;
  traits?: Omit<ProviderPlanTraits, "settings">;
}): BackgroundResearchOperationPlan {
  const builtTraits = buildTraits(config.settings, traits);

  return {
    ...plan,
    deliveryMode: "background-research",
    ...(builtTraits ? { traits: builtTraits } : {}),
  };
}

function buildSinglePlan<TResult>(
  deliveryMode: SingleProviderOperationPlan<TResult>["deliveryMode"],
  settings: ExecutionSettings | undefined,
  traits: Omit<ProviderPlanTraits, "settings"> | undefined,
  plan: Omit<SingleProviderOperationPlan<TResult>, "deliveryMode" | "traits">,
): SingleProviderOperationPlan<TResult> {
  const builtTraits = buildTraits(settings, traits);

  return {
    ...plan,
    deliveryMode,
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
