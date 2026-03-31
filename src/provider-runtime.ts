import type { ContentsResponse } from "./contents.js";
import {
  formatErrorMessage,
  parseLocalExecutionOptions,
  runWithExecutionPolicy,
} from "./execution-policy.js";
import { formatProviderDiagnostic } from "./provider-diagnostics.js";
import type {
  ExecutionSettings,
  ProviderContext,
  ProviderPlan,
  SearchResponse,
  ToolOutput,
} from "./types.js";

export async function executeOperationPlan<
  TResult extends SearchResponse | ContentsResponse | ToolOutput,
>(
  plan: ProviderPlan<TResult>,
  options: Record<string, unknown> | undefined,
  context: ProviderContext,
): Promise<TResult> {
  if (plan.capability === "research") {
    rejectResearchExecutionControls(plan.providerLabel, options);

    try {
      return await plan.execute(context);
    } catch (error) {
      throw new Error(
        formatProviderDiagnostic(plan.providerLabel, formatErrorMessage(error)),
      );
    }
  }

  const requestPolicy = resolveExecutionPolicy(plan.traits?.settings, options);
  try {
    return await runWithExecutionPolicy(
      `${plan.providerLabel} ${plan.capability} request`,
      plan.execute,
      requestPolicy,
      context,
    );
  } catch (error) {
    throw new Error(
      formatProviderDiagnostic(plan.providerLabel, formatErrorMessage(error)),
    );
  }
}

function resolveExecutionPolicy(
  defaults: ExecutionSettings | undefined,
  options: Record<string, unknown> | undefined,
) {
  rejectResearchOnlyExecutionControls(options);
  const localOptions = parseLocalExecutionOptions(options);

  return {
    requestTimeoutMs:
      localOptions.requestTimeoutMs ?? defaults?.requestTimeoutMs,
    retryCount: localOptions.retryCount ?? defaults?.retryCount ?? 0,
    retryDelayMs: localOptions.retryDelayMs ?? defaults?.retryDelayMs ?? 2000,
  };
}

function rejectResearchExecutionControls(
  providerLabel: string,
  options: Record<string, unknown> | undefined,
): void {
  if (!options) {
    return;
  }

  const blockedKeys = [
    "requestTimeoutMs",
    "retryCount",
    "retryDelayMs",
    "pollIntervalMs",
    "timeoutMs",
    "maxConsecutivePollErrors",
    "resumeId",
    "resumeInteractionId",
  ].filter((key) => options[key] !== undefined);

  if (blockedKeys.length === 0) {
    return;
  }

  throw new Error(
    `${providerLabel} research is always async and does not accept local execution controls. Remove ${blockedKeys.join(", ")} from options.`,
  );
}

function rejectResearchOnlyExecutionControls(
  options: Record<string, unknown> | undefined,
): void {
  if (!options) {
    return;
  }

  if (options.resumeInteractionId !== undefined) {
    throw new Error(
      "resumeInteractionId is not supported. Use the async web_research workflow instead.",
    );
  }

  const blockedKeys = [
    "pollIntervalMs",
    "timeoutMs",
    "maxConsecutivePollErrors",
    "resumeId",
  ].filter((key) => options[key] !== undefined);

  if (blockedKeys.length === 0) {
    return;
  }

  throw new Error(
    `These controls only apply to internal research execution and are not supported here: ${blockedKeys.join(", ")}.`,
  );
}
