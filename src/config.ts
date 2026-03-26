import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { supportsTool } from "./provider-tools.js";
import type {
  Claude,
  Codex,
  Custom,
  CustomCommandConfig,
  Exa,
  ExecutionSettings,
  Gemini,
  Parallel,
  Perplexity,
  ProviderId,
  SearchSettings,
  Settings,
  Tool,
  Tools,
  Valyu,
  WebProviders,
} from "./types.js";
import { PROVIDER_IDS, TOOLS } from "./types.js";

const CONFIG_FILE_NAME = "web-providers.json";
const commandValueCache = new Map<
  string,
  { value?: string; errorMessage?: string }
>();

export function getConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

export function createDefaultConfig(): WebProviders {
  return {
    tools: {
      search: "codex",
    },
  };
}

export async function loadConfig(): Promise<WebProviders> {
  return readConfigFile(getConfigPath());
}

export async function readConfigFile(path: string): Promise<WebProviders> {
  try {
    const content = await readFile(path, "utf-8");
    return parseConfig(content, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyConfig();
    }
    throw error;
  }
}

export async function writeConfigFile(config: WebProviders): Promise<string> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const cleaned = structuredClone(config);
  cleanupConfig(cleaned);
  await writeFile(path, serializeConfig(cleaned), "utf-8");
  return path;
}

export function parseConfig(
  text: string,
  source = CONFIG_FILE_NAME,
): WebProviders {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${(error as Error).message}`);
  }

  return normalizeConfig(raw, source);
}

export function parseProviderConfig(
  providerId: ProviderId,
  text: string,
  source = CONFIG_FILE_NAME,
): Claude | Codex | Custom | Exa | Gemini | Perplexity | Parallel | Valyu {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${(error as Error).message}`);
  }

  if (!isPlainObject(raw)) {
    throw new Error(`Provider config in ${source} must be a JSON object.`);
  }

  const wrapper = normalizeConfig(
    {
      providers: {
        [providerId]: raw,
      },
    },
    source,
  );

  const parsed = wrapper.providers?.[providerId];
  if (!parsed) {
    throw new Error(`Failed to parse provider '${providerId}' in ${source}.`);
  }

  return parsed;
}

export function serializeConfig(config: WebProviders): string {
  return `${JSON.stringify(toPublicConfig(config), null, 2)}\n`;
}

export function resolveConfigValue(
  reference: string | undefined,
): string | undefined {
  if (!reference) return undefined;
  if (reference.startsWith("!")) {
    const cached = commandValueCache.get(reference);
    if (cached) {
      if (cached.errorMessage) {
        throw new Error(cached.errorMessage);
      }
      return cached.value;
    }

    try {
      const output = execSync(reference.slice(1), {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const value = output.length > 0 ? output : undefined;
      commandValueCache.set(reference, { value });
      return value;
    } catch (error) {
      const errorMessage = (error as Error).message;
      commandValueCache.set(reference, { errorMessage });
      throw error;
    }
  }
  const envValue = process.env[reference];
  if (envValue !== undefined) {
    return envValue;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    return undefined;
  }
  return reference;
}

export function resolveEnvMap(
  envMap: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!envMap) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(envMap)
      .map(([key, value]) => [key, resolveConfigValue(value)])
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function emptyConfig(): WebProviders {
  return {};
}

function normalizeConfig(raw: unknown, source: string): WebProviders {
  if (!isPlainObject(raw)) {
    throw new Error(`Config in ${source} must be a JSON object.`);
  }

  const config: WebProviders = {};

  if (raw.tools !== undefined) {
    config.tools = parseToolProviderMapping(raw.tools, source, "tools");
  }

  if (raw.settings !== undefined) {
    config.settings = parseSettingsConfig(raw.settings, source);
  }

  if (raw.providers !== undefined) {
    if (!isPlainObject(raw.providers)) {
      throw new Error(`'providers' in ${source} must be a JSON object.`);
    }

    config.providers = {};
    if (raw.providers.claude !== undefined) {
      config.providers.claude = normalizeClaudeProvider(
        raw.providers.claude,
        source,
      );
    }
    if (raw.providers.codex !== undefined) {
      config.providers.codex = normalizeCodexProvider(
        raw.providers.codex,
        source,
      );
    }
    if (raw.providers.custom !== undefined) {
      config.providers.custom = normalizeCustomProvider(
        raw.providers.custom,
        source,
      );
    }
    if (raw.providers.exa !== undefined) {
      config.providers.exa = normalizeExaProvider(raw.providers.exa, source);
    }
    if (raw.providers.gemini !== undefined) {
      config.providers.gemini = normalizeGeminiProvider(
        raw.providers.gemini,
        source,
      );
    }
    if (raw.providers.perplexity !== undefined) {
      config.providers.perplexity = normalizePerplexityProvider(
        raw.providers.perplexity,
        source,
      );
    }
    if (raw.providers.parallel !== undefined) {
      config.providers.parallel = normalizeParallelProvider(
        raw.providers.parallel,
        source,
      );
    }
    if (raw.providers.valyu !== undefined) {
      config.providers.valyu = normalizeValyuProvider(
        raw.providers.valyu,
        source,
      );
    }

    const unknownProviders = Object.keys(raw.providers).filter(
      (key) =>
        key !== "claude" &&
        key !== "codex" &&
        key !== "custom" &&
        key !== "exa" &&
        key !== "gemini" &&
        key !== "perplexity" &&
        key !== "parallel" &&
        key !== "valyu",
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`,
      );
    }
  }

  cleanupConfig(config);

  return config;
}

function normalizeClaudeProvider(raw: unknown, source: string): Claude {
  const provider = parseProviderObject(raw, source, "claude");
  rejectLegacyProviderToolFields(provider, source, "claude");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.claude.options",
  );

  rejectRemovedProviderEnabledField(provider, source, "claude");

  return {
    pathToClaudeCodeExecutable: parseOptionalString(
      provider.pathToClaudeCodeExecutable,
      source,
      "providers.claude.pathToClaudeCodeExecutable",
    ),
    options:
      options === undefined
        ? undefined
        : {
            model: parseOptionalString(
              options.model,
              source,
              "providers.claude.options.model",
            ),
            effort: parseOptionalLiteral(
              options.effort,
              source,
              "providers.claude.options.effort",
              ["low", "medium", "high", "max"] as const,
            ),
            maxTurns: parseOptionalInteger(
              options.maxTurns,
              source,
              "providers.claude.options.maxTurns",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.claude.settings",
    ),
  };
}

function normalizeCodexProvider(raw: unknown, source: string): Codex {
  const provider = parseProviderObject(raw, source, "codex");
  rejectLegacyProviderToolFields(provider, source, "codex");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.codex.options",
  );
  rejectRemovedProviderEnabledField(provider, source, "codex");
  return {
    codexPath: parseOptionalString(
      provider.codexPath,
      source,
      "providers.codex.codexPath",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.codex.baseUrl",
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.codex.apiKey",
    ),
    env: parseOptionalStringMap(provider.env, source, "providers.codex.env"),
    config: parseOptionalJsonObject(
      provider.config,
      source,
      "providers.codex.config",
    ),
    options:
      options === undefined
        ? undefined
        : {
            model: parseOptionalString(
              options.model,
              source,
              "providers.codex.options.model",
            ),
            modelReasoningEffort: parseOptionalLiteral(
              options.modelReasoningEffort,
              source,
              "providers.codex.options.modelReasoningEffort",
              ["minimal", "low", "medium", "high", "xhigh"] as const,
            ),
            networkAccessEnabled: parseOptionalBoolean(
              options.networkAccessEnabled,
              source,
              "providers.codex.options.networkAccessEnabled",
            ),
            webSearchMode: parseOptionalLiteral(
              options.webSearchMode,
              source,
              "providers.codex.options.webSearchMode",
              ["disabled", "cached", "live"] as const,
            ),
            webSearchEnabled: parseOptionalBoolean(
              options.webSearchEnabled,
              source,
              "providers.codex.options.webSearchEnabled",
            ),
            additionalDirectories: parseOptionalStringArray(
              options.additionalDirectories,
              source,
              "providers.codex.options.additionalDirectories",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.codex.settings",
    ),
  };
}

function normalizeExaProvider(raw: unknown, source: string): Exa {
  const provider = parseProviderObject(raw, source, "exa");
  rejectLegacyProviderToolFields(provider, source, "exa");
  rejectRemovedProviderEnabledField(provider, source, "exa");
  return {
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.exa.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.exa.baseUrl",
    ),
    options: parseOptionalJsonObject(
      provider.options,
      source,
      "providers.exa.options",
    ),
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.exa.settings",
    ),
  };
}

function normalizeValyuProvider(raw: unknown, source: string): Valyu {
  const provider = parseProviderObject(raw, source, "valyu");
  rejectLegacyProviderToolFields(provider, source, "valyu");
  rejectRemovedProviderEnabledField(provider, source, "valyu");
  return {
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.valyu.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.valyu.baseUrl",
    ),
    options: parseOptionalJsonObject(
      provider.options,
      source,
      "providers.valyu.options",
    ),
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.valyu.settings",
    ),
  };
}

function normalizeGeminiProvider(raw: unknown, source: string): Gemini {
  const provider = parseProviderObject(raw, source, "gemini");
  rejectLegacyProviderToolFields(provider, source, "gemini");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.gemini.options",
  );

  rejectRemovedProviderEnabledField(provider, source, "gemini");

  return {
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.gemini.apiKey",
    ),
    options:
      options === undefined
        ? undefined
        : {
            apiVersion: parseOptionalString(
              options.apiVersion,
              source,
              "providers.gemini.options.apiVersion",
            ),
            searchModel: parseOptionalString(
              options.searchModel,
              source,
              "providers.gemini.options.searchModel",
            ),
            answerModel: parseOptionalString(
              options.answerModel,
              source,
              "providers.gemini.options.answerModel",
            ),
            researchAgent: parseOptionalString(
              options.researchAgent,
              source,
              "providers.gemini.options.researchAgent",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.gemini.settings",
    ),
  };
}

function normalizePerplexityProvider(raw: unknown, source: string): Perplexity {
  const provider = parseProviderObject(raw, source, "perplexity");
  rejectLegacyProviderToolFields(provider, source, "perplexity");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.perplexity.options",
  );

  rejectRemovedProviderEnabledField(provider, source, "perplexity");

  return {
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.perplexity.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.perplexity.baseUrl",
    ),
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              options.search,
              source,
              "providers.perplexity.options.search",
            ),
            answer: parseOptionalJsonObject(
              options.answer,
              source,
              "providers.perplexity.options.answer",
            ),
            research: parseOptionalJsonObject(
              options.research,
              source,
              "providers.perplexity.options.research",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.perplexity.settings",
    ),
  };
}

function normalizeParallelProvider(raw: unknown, source: string): Parallel {
  const provider = parseProviderObject(raw, source, "parallel");
  rejectLegacyProviderToolFields(provider, source, "parallel");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.parallel.options",
  );

  rejectRemovedProviderEnabledField(provider, source, "parallel");

  return {
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.parallel.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.parallel.baseUrl",
    ),
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              options.search,
              source,
              "providers.parallel.options.search",
            ),
            extract: parseOptionalJsonObject(
              options.extract,
              source,
              "providers.parallel.options.extract",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.parallel.settings",
    ),
  };
}

function normalizeCustomProvider(raw: unknown, source: string): Custom {
  const provider = parseProviderObject(raw, source, "custom");
  rejectLegacyProviderToolFields(provider, source, "custom");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.custom.options",
  );

  rejectRemovedProviderEnabledField(provider, source, "custom");

  return {
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalCustomCommand(
              options.search,
              source,
              "providers.custom.options.search",
            ),
            contents: parseOptionalCustomCommand(
              options.contents,
              source,
              "providers.custom.options.contents",
            ),
            answer: parseOptionalCustomCommand(
              options.answer,
              source,
              "providers.custom.options.answer",
            ),
            research: parseOptionalCustomCommand(
              options.research,
              source,
              "providers.custom.options.research",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.custom.settings",
    ),
  };
}

function toPublicConfig(config: WebProviders): Record<string, unknown> {
  const providers = config.providers
    ? Object.fromEntries(
        Object.entries(config.providers).flatMap(([providerId, provider]) =>
          provider ? [[providerId, toPublicProviderConfig(provider)]] : [],
        ),
      )
    : undefined;

  return {
    ...(config.tools ? { tools: config.tools } : {}),
    ...(config.settings ? { settings: config.settings } : {}),
    ...(providers && Object.keys(providers).length > 0 ? { providers } : {}),
  } as unknown as Record<string, unknown>;
}

function toPublicProviderConfig(
  provider:
    | Claude
    | Codex
    | Custom
    | Exa
    | Gemini
    | Perplexity
    | Parallel
    | Valyu,
): Record<string, unknown> {
  return {
    ...("pathToClaudeCodeExecutable" in provider &&
    provider.pathToClaudeCodeExecutable !== undefined
      ? {
          pathToClaudeCodeExecutable: provider.pathToClaudeCodeExecutable,
        }
      : {}),
    ...("codexPath" in provider && provider.codexPath !== undefined
      ? { codexPath: provider.codexPath }
      : {}),
    ...("baseUrl" in provider && provider.baseUrl !== undefined
      ? { baseUrl: provider.baseUrl }
      : {}),
    ...("apiKey" in provider && provider.apiKey !== undefined
      ? { apiKey: provider.apiKey }
      : {}),
    ...("env" in provider && provider.env !== undefined
      ? { env: provider.env }
      : {}),
    ...("config" in provider && provider.config !== undefined
      ? { config: provider.config }
      : {}),
    ...(provider.options ? { options: provider.options } : {}),
    ...(provider.settings ? { settings: provider.settings } : {}),
  } as unknown as Record<string, unknown>;
}

function parseOptionalExecutionPolicy(
  value: unknown,
  source: string,
  field: string,
): ExecutionSettings | undefined {
  if (value === undefined) {
    return undefined;
  }

  const settings = parseOptionalJsonObject(value, source, field);
  if (!settings) {
    return undefined;
  }

  const parsed: ExecutionSettings = {
    requestTimeoutMs: parseOptionalInteger(
      settings.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`,
    ),
    retryCount: parseOptionalNonNegativeInteger(
      settings.retryCount,
      source,
      `${field}.retryCount`,
    ),
    retryDelayMs: parseOptionalInteger(
      settings.retryDelayMs,
      source,
      `${field}.retryDelayMs`,
    ),
    researchPollIntervalMs: parseOptionalInteger(
      settings.researchPollIntervalMs,
      source,
      `${field}.researchPollIntervalMs`,
    ),
    researchTimeoutMs: parseOptionalInteger(
      settings.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`,
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      settings.researchMaxConsecutivePollErrors,
      source,
      `${field}.researchMaxConsecutivePollErrors`,
    ),
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : undefined;
}

function parseSettingsConfig(value: unknown, source: string): Settings {
  if (!isPlainObject(value)) {
    throw new Error(`'settings' in ${source} must be a JSON object.`);
  }

  const parsed: Settings = {
    requestTimeoutMs: parseOptionalInteger(
      value.requestTimeoutMs,
      source,
      "settings.requestTimeoutMs",
    ),
    retryCount: parseOptionalNonNegativeInteger(
      value.retryCount,
      source,
      "settings.retryCount",
    ),
    retryDelayMs: parseOptionalInteger(
      value.retryDelayMs,
      source,
      "settings.retryDelayMs",
    ),
    researchPollIntervalMs: parseOptionalInteger(
      value.researchPollIntervalMs,
      source,
      "settings.researchPollIntervalMs",
    ),
    researchTimeoutMs: parseOptionalInteger(
      value.researchTimeoutMs,
      source,
      "settings.researchTimeoutMs",
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      value.researchMaxConsecutivePollErrors,
      source,
      "settings.researchMaxConsecutivePollErrors",
    ),
    search:
      value.search !== undefined
        ? parseSearchSettings(value.search, source, "settings.search")
        : undefined,
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : {};
}

function parseProviderObject(
  raw: unknown,
  source: string,
  field: string,
): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error(`'providers.${field}' in ${source} must be a JSON object.`);
  }
  return raw;
}

function parseOptionalJsonObject(
  value: unknown,
  source: string,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  return value;
}

function parseToolProviderMapping(
  value: unknown,
  source: string,
  field: string,
): Tools {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: Tools = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!TOOLS.includes(key as Tool)) {
      throw new Error(`Unknown tools in ${source}: ${key}.`);
    }
    parsed[key as Tool] = parseToolProviderMappingEntry(
      key as Tool,
      entry,
      source,
      `${field}.${key}`,
    );
  }

  return parsed;
}

function parseToolProviderMappingEntry(
  tool: Tool,
  value: unknown,
  source: string,
  field: string,
): ProviderId {
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsTool(providerId, tool)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${tool}'.`,
    );
  }
  return providerId;
}

function parseSearchSettings(
  value: unknown,
  source: string,
  field: string,
): SearchSettings {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: SearchSettings = {
    provider: parseOptionalToolProviderId(
      value.provider,
      source,
      `${field}.provider`,
      "contents",
    ),
    maxUrls: parseOptionalInteger(value.maxUrls, source, `${field}.maxUrls`),
    ttlMs: parseOptionalInteger(value.ttlMs, source, `${field}.ttlMs`),
  };

  const unknownFields = Object.keys(value).filter(
    (key) => key !== "provider" && key !== "maxUrls" && key !== "ttlMs",
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Unknown search settings in ${source}: ${unknownFields.join(", ")}.`,
    );
  }

  return parsed;
}

function parseOptionalToolProviderId(
  value: unknown,
  source: string,
  field: string,
  tool: Tool,
): ProviderId | undefined {
  if (value === undefined) {
    return undefined;
  }
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsTool(providerId, tool)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${tool}'.`,
    );
  }
  return providerId;
}

function rejectLegacyProviderToolFields(
  provider: Record<string, unknown>,
  source: string,
  providerId: ProviderId,
): void {
  if (provider.tools !== undefined) {
    throw new Error(
      `'providers.${providerId}.tools' in ${source} is no longer supported. Use top-level 'tools' mappings instead.`,
    );
  }
}

function rejectRemovedProviderEnabledField(
  provider: Record<string, unknown>,
  source: string,
  providerId: ProviderId,
): void {
  if (provider.enabled !== undefined) {
    throw new Error(
      `'providers.${providerId}.enabled' in ${source} is no longer supported. Providers are always on; use top-level 'tools' mappings to route or disable capabilities.`,
    );
  }
}

function parseOptionalCustomCommand(
  value: unknown,
  source: string,
  field: string,
): CustomCommandConfig | undefined {
  const config = parseOptionalJsonObject(value, source, field);
  if (!config) {
    return undefined;
  }

  const argv = parseOptionalStringArray(config.argv, source, `${field}.argv`);
  if (
    argv !== undefined &&
    (argv.length === 0 || argv.some((entry) => entry.trim().length === 0))
  ) {
    throw new Error(
      `'${field}.argv' in ${source} must be a non-empty array of non-empty strings.`,
    );
  }

  return {
    argv,
    cwd: parseOptionalString(config.cwd, source, `${field}.cwd`),
    env: parseOptionalStringMap(config.env, source, `${field}.env`),
  };
}

function parseOptionalStringMap(
  value: unknown,
  source: string,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(
      `'${field}' in ${source} must be a JSON object of strings.`,
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      parseString(entry, source, `${field}.${key}`),
    ]),
  );
}

function parseOptionalStringArray(
  value: unknown,
  source: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`'${field}' in ${source} must be an array of strings.`);
  }
  return value.map((entry, index) =>
    parseString(entry, source, `${field}[${index}]`),
  );
}

function parseOptionalBoolean(
  value: unknown,
  source: string,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`'${field}' in ${source} must be a boolean.`);
  }
  return value;
}

function parseBoolean(value: unknown, source: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`'${field}' in ${source} must be a boolean.`);
  }
  return value;
}

function parseOptionalString(
  value: unknown,
  source: string,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return parseString(value, source, field);
}

function parseString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`'${field}' in ${source} must be a string.`);
  }
  return value;
}

function parseOptionalInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`'${field}' in ${source} must be a positive integer.`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`'${field}' in ${source} must be a non-negative integer.`);
  }
  return value;
}

function parseOptionalLiteral<T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T[number];
}

function parseLiteral<T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] {
  const parsed = parseOptionalLiteral(value, source, field, allowed);
  if (parsed === undefined) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return parsed;
}

function cleanupConfig(config: WebProviders): void {
  if (config.settings) {
    if (
      config.settings.search &&
      Object.keys(config.settings.search).length === 0
    ) {
      delete config.settings.search;
    }

    if (Object.keys(config.settings).length === 0) {
      delete config.settings;
    }
  }

  if (config.providers) {
    for (const providerId of Object.keys(config.providers) as ProviderId[]) {
      const provider = config.providers[providerId] as
        | Record<string, unknown>
        | undefined;
      if (!provider) {
        delete config.providers[providerId];
        continue;
      }
      cleanupNestedEmptyObjects(provider);
      if (Object.keys(provider).length === 0) {
        delete config.providers[providerId];
      }
    }

    if (Object.keys(config.providers).length === 0) {
      delete config.providers;
    }
  }

  if (config.tools && Object.keys(config.tools).length === 0) {
    delete config.tools;
  }
}

function cleanupNestedEmptyObjects(value: Record<string, unknown>): void {
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        delete value[key];
      }
      continue;
    }

    if (isPlainObject(entry)) {
      cleanupNestedEmptyObjects(entry);
      if (Object.keys(entry).length === 0) {
        delete value[key];
      }
      continue;
    }

    if (entry === undefined) {
      delete value[key];
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
