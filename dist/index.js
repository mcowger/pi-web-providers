// src/index.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join4 } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getMarkdownTheme,
  keyHint,
  truncateHead
} from "@mariozechner/pi-coding-agent";
import {
  Editor,
  getEditorKeybindings,
  Key,
  Markdown,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// src/config.ts
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

// src/execution-policy-defaults.ts
var DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS = 10;

// src/provider-tools.ts
var PROVIDER_TOOL_IDS = [
  "search",
  "contents",
  "answer",
  "research"
];
var PROVIDER_TOOLS = {
  claude: ["search", "answer"],
  cloudflare: ["contents"],
  codex: ["search"],
  "custom-cli": ["search", "contents", "answer", "research"],
  exa: ["search", "contents", "answer", "research"],
  gemini: ["search", "answer", "research"],
  perplexity: ["search", "answer", "research"],
  parallel: ["search", "contents"],
  valyu: ["search", "contents", "answer", "research"]
};
var PROVIDER_TOOL_META = {
  search: {
    label: "Search",
    help: "Enable the provider's search tool."
  },
  contents: {
    label: "Contents",
    help: "Enable the provider's content extraction tool."
  },
  answer: {
    label: "Answer",
    help: "Enable the provider's answer generation tool."
  },
  research: {
    label: "Research",
    help: "Enable the provider's long-form research tool."
  }
};
function supportsProviderTool(providerId, toolId) {
  return PROVIDER_TOOLS[providerId].includes(toolId);
}
function getCompatibleProvidersForTool(toolId) {
  return Object.keys(PROVIDER_TOOLS).filter(
    (providerId) => supportsProviderTool(providerId, toolId)
  );
}
function getMappedProviderForCapability(config, capability) {
  return config.tools?.[capability];
}

// src/types.ts
var PROVIDER_IDS = [
  "claude",
  "cloudflare",
  "codex",
  "custom-cli",
  "exa",
  "gemini",
  "perplexity",
  "parallel",
  "valyu"
];
var EXECUTION_CONTROL_KEYS = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "pollIntervalMs",
  "timeoutMs",
  "maxConsecutivePollErrors",
  "resumeId"
];

// src/config.ts
var CONFIG_FILE_NAME = "web-providers.json";
var commandValueCache = /* @__PURE__ */ new Map();
function getConfigPath() {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}
async function loadConfig() {
  return readConfigFile(getConfigPath());
}
async function readConfigFile(path) {
  try {
    const content = await readFile(path, "utf-8");
    return parseConfig(content, path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyConfig();
    }
    throw error;
  }
}
async function writeConfigFile(config) {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeConfig(config), "utf-8");
  return path;
}
function parseConfig(text, source = CONFIG_FILE_NAME) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error.message}`);
  }
  return normalizeConfig(raw, source);
}
function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}
`;
}
function resolveConfigValue(reference) {
  if (!reference) return void 0;
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
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      const value = output.length > 0 ? output : void 0;
      commandValueCache.set(reference, { value });
      return value;
    } catch (error) {
      const errorMessage = error.message;
      commandValueCache.set(reference, { errorMessage });
      throw error;
    }
  }
  const envValue = process.env[reference];
  if (envValue !== void 0) {
    return envValue;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    return void 0;
  }
  return reference;
}
function resolveEnvMap(envMap) {
  if (!envMap) return void 0;
  const resolved = Object.fromEntries(
    Object.entries(envMap).map(([key, value]) => [key, resolveConfigValue(value)]).filter(
      (entry) => typeof entry[1] === "string"
    )
  );
  return Object.keys(resolved).length > 0 ? resolved : void 0;
}
function emptyConfig() {
  return {};
}
function normalizeConfig(raw, source) {
  if (!isPlainObject(raw)) {
    throw new Error(`Config in ${source} must be a JSON object.`);
  }
  const config = {};
  if (raw.tools !== void 0) {
    config.tools = parseToolProviderMapping(raw.tools, source, "tools");
  }
  if (raw.toolSettings !== void 0) {
    config.toolSettings = parseToolSettingsConfig(raw.toolSettings, source);
  }
  if (raw.genericSettings !== void 0) {
    config.genericSettings = parseOptionalGenericSettings(
      raw.genericSettings,
      source,
      "genericSettings"
    );
  }
  if (raw.providers !== void 0) {
    if (!isPlainObject(raw.providers)) {
      throw new Error(`'providers' in ${source} must be a JSON object.`);
    }
    config.providers = {};
    if (raw.providers.claude !== void 0) {
      config.providers.claude = normalizeClaudeProvider(
        raw.providers.claude,
        source
      );
    }
    if (raw.providers.cloudflare !== void 0) {
      config.providers.cloudflare = normalizeCloudflareProvider(
        raw.providers.cloudflare,
        source
      );
    }
    if (raw.providers.codex !== void 0) {
      config.providers.codex = normalizeCodexProvider(
        raw.providers.codex,
        source
      );
    }
    if (raw.providers["custom-cli"] !== void 0) {
      config.providers["custom-cli"] = normalizeCustomCliProvider(
        raw.providers["custom-cli"],
        source
      );
    }
    if (raw.providers.exa !== void 0) {
      config.providers.exa = normalizeExaProvider(raw.providers.exa, source);
    }
    if (raw.providers.gemini !== void 0) {
      config.providers.gemini = normalizeGeminiProvider(
        raw.providers.gemini,
        source
      );
    }
    if (raw.providers.perplexity !== void 0) {
      config.providers.perplexity = normalizePerplexityProvider(
        raw.providers.perplexity,
        source
      );
    }
    if (raw.providers.parallel !== void 0) {
      config.providers.parallel = normalizeParallelProvider(
        raw.providers.parallel,
        source
      );
    }
    if (raw.providers.valyu !== void 0) {
      config.providers.valyu = normalizeValyuProvider(
        raw.providers.valyu,
        source
      );
    }
    const unknownProviders = Object.keys(raw.providers).filter(
      (key) => key !== "claude" && key !== "cloudflare" && key !== "codex" && key !== "custom-cli" && key !== "exa" && key !== "gemini" && key !== "perplexity" && key !== "parallel" && key !== "valyu"
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`
      );
    }
  }
  if (config.providers) {
    for (const providerId of Object.keys(config.providers)) {
      const provider = config.providers[providerId];
      if (provider && provider.enabled === void 0) {
        provider.enabled = inferProviderEnabled(config, providerId);
      }
    }
  }
  return config;
}
function normalizeClaudeProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "claude");
  rejectLegacyProviderToolFields(provider, source, "claude");
  const native = parseOptionalJsonObject(
    getProviderNativeSource(provider),
    source,
    provider.native !== void 0 ? "providers.claude.native" : "providers.claude.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.claude.enabled"
    ),
    pathToClaudeCodeExecutable: parseOptionalString(
      provider.pathToClaudeCodeExecutable,
      source,
      "providers.claude.pathToClaudeCodeExecutable"
    ),
    native: native === void 0 ? void 0 : {
      model: parseOptionalString(
        native.model,
        source,
        "providers.claude.native.model"
      ),
      effort: parseOptionalLiteral(
        native.effort,
        source,
        "providers.claude.native.effort",
        ["low", "medium", "high", "max"]
      ),
      maxTurns: parseOptionalInteger(
        native.maxTurns,
        source,
        "providers.claude.native.maxTurns"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.claude.policy" : "providers.claude.defaults"
    )
  };
}
function normalizeCloudflareProvider(raw, source) {
  if (!isPlainObject(raw)) {
    throw new Error(
      `'providers.cloudflare' in ${source} must be a JSON object.`
    );
  }
  rejectLegacyProviderToolFields(raw, source, "cloudflare");
  const config = {};
  if (typeof raw.enabled === "boolean") {
    config.enabled = raw.enabled;
  }
  config.apiToken = parseOptionalString(
    raw.apiToken,
    "providers.cloudflare.apiToken",
    source
  );
  config.accountId = parseOptionalString(
    raw.accountId,
    "providers.cloudflare.accountId",
    source
  );
  if (raw.native !== void 0) {
    if (!isPlainObject(raw.native)) {
      throw new Error(
        `'providers.cloudflare.native' in ${source} must be a JSON object.`
      );
    }
    config.native = {};
    if (raw.native.requestTimeoutMs !== void 0) {
      if (typeof raw.native.requestTimeoutMs !== "number" || !Number.isInteger(raw.native.requestTimeoutMs) || raw.native.requestTimeoutMs < 1) {
        throw new Error(
          `'providers.cloudflare.native.requestTimeoutMs' in ${source} must be a positive integer.`
        );
      }
      config.native.requestTimeoutMs = raw.native.requestTimeoutMs;
    }
  }
  if (raw.policy !== void 0) {
    config.policy = parseOptionalExecutionPolicy(
      raw.policy,
      "providers.cloudflare.policy",
      source
    );
  }
  return config;
}
function normalizeCodexProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "codex");
  rejectLegacyProviderToolFields(provider, source, "codex");
  const native = parseOptionalJsonObject(
    getProviderNativeSource(provider),
    source,
    provider.native !== void 0 ? "providers.codex.native" : "providers.codex.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.codex.enabled"
    ),
    codexPath: parseOptionalString(
      provider.codexPath,
      source,
      "providers.codex.codexPath"
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.codex.baseUrl"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.codex.apiKey"
    ),
    env: parseOptionalStringMap(provider.env, source, "providers.codex.env"),
    config: parseOptionalJsonObject(
      provider.config,
      source,
      "providers.codex.config"
    ),
    native: native === void 0 ? void 0 : {
      model: parseOptionalString(
        native.model,
        source,
        "providers.codex.native.model"
      ),
      modelReasoningEffort: parseOptionalLiteral(
        native.modelReasoningEffort,
        source,
        "providers.codex.native.modelReasoningEffort",
        ["minimal", "low", "medium", "high", "xhigh"]
      ),
      networkAccessEnabled: parseOptionalBoolean(
        native.networkAccessEnabled,
        source,
        "providers.codex.native.networkAccessEnabled"
      ),
      webSearchMode: parseOptionalLiteral(
        native.webSearchMode,
        source,
        "providers.codex.native.webSearchMode",
        ["disabled", "cached", "live"]
      ),
      webSearchEnabled: parseOptionalBoolean(
        native.webSearchEnabled,
        source,
        "providers.codex.native.webSearchEnabled"
      ),
      additionalDirectories: parseOptionalStringArray(
        native.additionalDirectories,
        source,
        "providers.codex.native.additionalDirectories"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.codex.policy" : "providers.codex.defaults"
    )
  };
}
function normalizeExaProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "exa");
  rejectLegacyProviderToolFields(provider, source, "exa");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.exa.enabled"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.exa.apiKey"
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.exa.baseUrl"
    ),
    native: parseOptionalJsonObject(
      stripPolicyFields(getProviderNativeSource(provider)),
      source,
      provider.native !== void 0 ? "providers.exa.native" : "providers.exa.defaults"
    ),
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.exa.policy" : "providers.exa.defaults"
    )
  };
}
function normalizeValyuProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "valyu");
  rejectLegacyProviderToolFields(provider, source, "valyu");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.valyu.enabled"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.valyu.apiKey"
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.valyu.baseUrl"
    ),
    native: parseOptionalJsonObject(
      stripPolicyFields(getProviderNativeSource(provider)),
      source,
      provider.native !== void 0 ? "providers.valyu.native" : "providers.valyu.defaults"
    ),
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.valyu.policy" : "providers.valyu.defaults"
    )
  };
}
function normalizeGeminiProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "gemini");
  rejectLegacyProviderToolFields(provider, source, "gemini");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== void 0 ? "providers.gemini.native" : "providers.gemini.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.gemini.enabled"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.gemini.apiKey"
    ),
    native: native === void 0 ? void 0 : {
      apiVersion: parseOptionalString(
        native.apiVersion,
        source,
        "providers.gemini.native.apiVersion"
      ),
      searchModel: parseOptionalString(
        native.searchModel,
        source,
        "providers.gemini.native.searchModel"
      ),
      answerModel: parseOptionalString(
        native.answerModel,
        source,
        "providers.gemini.native.answerModel"
      ),
      researchAgent: parseOptionalString(
        native.researchAgent,
        source,
        "providers.gemini.native.researchAgent"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.gemini.policy" : "providers.gemini.defaults"
    )
  };
}
function normalizePerplexityProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "perplexity");
  rejectLegacyProviderToolFields(provider, source, "perplexity");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== void 0 ? "providers.perplexity.native" : "providers.perplexity.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.perplexity.enabled"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.perplexity.apiKey"
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.perplexity.baseUrl"
    ),
    native: native === void 0 ? void 0 : {
      search: parseOptionalJsonObject(
        native.search,
        source,
        "providers.perplexity.native.search"
      ),
      answer: parseOptionalJsonObject(
        native.answer,
        source,
        "providers.perplexity.native.answer"
      ),
      research: parseOptionalJsonObject(
        native.research,
        source,
        "providers.perplexity.native.research"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.perplexity.policy" : "providers.perplexity.defaults"
    )
  };
}
function normalizeParallelProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "parallel");
  rejectLegacyProviderToolFields(provider, source, "parallel");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== void 0 ? "providers.parallel.native" : "providers.parallel.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.parallel.enabled"
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.parallel.apiKey"
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.parallel.baseUrl"
    ),
    native: native === void 0 ? void 0 : {
      search: parseOptionalJsonObject(
        native.search,
        source,
        "providers.parallel.native.search"
      ),
      extract: parseOptionalJsonObject(
        native.extract,
        source,
        "providers.parallel.native.extract"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.parallel.policy" : "providers.parallel.defaults"
    )
  };
}
function normalizeCustomCliProvider(raw, source) {
  const provider = parseProviderObject(raw, source, "custom-cli");
  rejectLegacyProviderToolFields(provider, source, "custom-cli");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== void 0 ? "providers.custom-cli.native" : "providers.custom-cli.defaults"
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.custom-cli.enabled"
    ),
    native: native === void 0 ? void 0 : {
      search: parseOptionalCustomCliCommand(
        native.search,
        source,
        "providers.custom-cli.native.search"
      ),
      contents: parseOptionalCustomCliCommand(
        native.contents,
        source,
        "providers.custom-cli.native.contents"
      ),
      answer: parseOptionalCustomCliCommand(
        native.answer,
        source,
        "providers.custom-cli.native.answer"
      ),
      research: parseOptionalCustomCliCommand(
        native.research,
        source,
        "providers.custom-cli.native.research"
      )
    },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== void 0 ? "providers.custom-cli.policy" : "providers.custom-cli.defaults"
    )
  };
}
function getProviderNativeSource(provider) {
  return provider.native ?? provider.defaults;
}
function getProviderPolicySource(provider) {
  return provider.policy ?? provider.defaults;
}
function stripPolicyFields(value) {
  if (!isPlainObject(value)) {
    return void 0;
  }
  const {
    requestTimeoutMs: _requestTimeoutMs,
    retryCount: _retryCount,
    retryDelayMs: _retryDelayMs,
    researchPollIntervalMs: _researchPollIntervalMs,
    researchTimeoutMs: _researchTimeoutMs,
    researchMaxConsecutivePollErrors: _researchMaxConsecutivePollErrors,
    ...native
  } = value;
  return Object.keys(native).length > 0 ? native : void 0;
}
function parseOptionalExecutionPolicy(value, source, field) {
  if (value === void 0) {
    return void 0;
  }
  const policy = parseOptionalJsonObject(value, source, field);
  if (!policy) {
    return void 0;
  }
  const parsed = {
    requestTimeoutMs: parseOptionalInteger(
      policy.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`
    ),
    retryCount: parseOptionalNonNegativeInteger(
      policy.retryCount,
      source,
      `${field}.retryCount`
    ),
    retryDelayMs: parseOptionalInteger(
      policy.retryDelayMs,
      source,
      `${field}.retryDelayMs`
    ),
    researchPollIntervalMs: parseOptionalInteger(
      policy.researchPollIntervalMs,
      source,
      `${field}.researchPollIntervalMs`
    ),
    researchTimeoutMs: parseOptionalInteger(
      policy.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      policy.researchMaxConsecutivePollErrors,
      source,
      `${field}.researchMaxConsecutivePollErrors`
    )
  };
  return Object.values(parsed).some((entry) => entry !== void 0) ? parsed : void 0;
}
function parseOptionalGenericSettings(value, source, field) {
  if (value === void 0) {
    return void 0;
  }
  const settings = parseOptionalJsonObject(value, source, field);
  if (!settings) {
    return void 0;
  }
  const parsed = {
    requestTimeoutMs: parseOptionalInteger(
      settings.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`
    ),
    retryCount: parseOptionalNonNegativeInteger(
      settings.retryCount,
      source,
      `${field}.retryCount`
    ),
    retryDelayMs: parseOptionalInteger(
      settings.retryDelayMs,
      source,
      `${field}.retryDelayMs`
    ),
    researchPollIntervalMs: parseOptionalInteger(
      settings.researchPollIntervalMs,
      source,
      `${field}.researchPollIntervalMs`
    ),
    researchTimeoutMs: parseOptionalInteger(
      settings.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      settings.researchMaxConsecutivePollErrors,
      source,
      `${field}.researchMaxConsecutivePollErrors`
    )
  };
  return Object.values(parsed).some((entry) => entry !== void 0) ? parsed : void 0;
}
function parseProviderObject(raw, source, field) {
  if (!isPlainObject(raw)) {
    throw new Error(`'providers.${field}' in ${source} must be a JSON object.`);
  }
  return raw;
}
function parseOptionalJsonObject(value, source, field) {
  if (value === void 0) return void 0;
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  return value;
}
function parseToolProviderMapping(value, source, field) {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  const parsed = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!PROVIDER_TOOL_IDS.includes(key)) {
      throw new Error(`Unknown tools in ${source}: ${key}.`);
    }
    parsed[key] = parseToolProviderMappingEntry(
      key,
      entry,
      source,
      `${field}.${key}`
    );
  }
  return parsed;
}
function parseToolProviderMappingEntry(capability, value, source, field) {
  if (value === null) {
    return null;
  }
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsProviderTool(providerId, capability)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${capability}'.`
    );
  }
  return providerId;
}
function parseToolSettingsConfig(value, source) {
  if (!isPlainObject(value)) {
    throw new Error(`'toolSettings' in ${source} must be a JSON object.`);
  }
  const parsed = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "search") {
      throw new Error(`Unknown tool settings in ${source}: ${key}.`);
    }
    parsed.search = parseSearchToolSettings(
      entry,
      source,
      "toolSettings.search"
    );
  }
  return parsed;
}
function parseSearchToolSettings(value, source, field) {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  const parsed = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== "prefetch") {
      throw new Error(`Unknown search tool settings in ${source}: ${key}.`);
    }
    parsed.prefetch = parseSearchContentsPrefetchConfig(
      entry,
      source,
      `${field}.prefetch`
    );
  }
  return parsed;
}
function parseSearchContentsPrefetchConfig(value, source, field) {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  const parsed = {
    provider: parseOptionalToolProviderId(
      value.provider,
      source,
      `${field}.provider`,
      "contents"
    ),
    maxUrls: parseOptionalInteger(value.maxUrls, source, `${field}.maxUrls`),
    ttlMs: parseOptionalInteger(value.ttlMs, source, `${field}.ttlMs`)
  };
  const unknownFields = Object.keys(value).filter(
    (key) => key !== "provider" && key !== "maxUrls" && key !== "ttlMs"
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Unknown prefetch settings in ${source}: ${unknownFields.join(", ")}.`
    );
  }
  return parsed;
}
function parseOptionalToolProviderId(value, source, field, capability) {
  if (value === void 0) {
    return void 0;
  }
  if (value === null) {
    return null;
  }
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsProviderTool(providerId, capability)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${capability}'.`
    );
  }
  return providerId;
}
function rejectLegacyProviderToolFields(provider, source, providerId) {
  if (provider.tools !== void 0) {
    throw new Error(
      `'providers.${providerId}.tools' in ${source} is no longer supported. Use top-level 'tools' mappings instead.`
    );
  }
}
function inferProviderEnabled(config, providerId) {
  return Object.values(config.tools ?? {}).some((mappedProviderId) => mappedProviderId === providerId);
}
function parseOptionalCustomCliCommand(value, source, field) {
  const config = parseOptionalJsonObject(value, source, field);
  if (!config) {
    return void 0;
  }
  const argv = parseOptionalStringArray(config.argv, source, `${field}.argv`);
  if (argv !== void 0 && (argv.length === 0 || argv.some((entry) => entry.trim().length === 0))) {
    throw new Error(
      `'${field}.argv' in ${source} must be a non-empty array of non-empty strings.`
    );
  }
  return {
    argv,
    cwd: parseOptionalString(config.cwd, source, `${field}.cwd`),
    env: parseOptionalStringMap(config.env, source, `${field}.env`)
  };
}
function parseOptionalStringMap(value, source, field) {
  if (value === void 0) return void 0;
  if (!isPlainObject(value)) {
    throw new Error(
      `'${field}' in ${source} must be a JSON object of strings.`
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      parseString(entry, source, `${field}.${key}`)
    ])
  );
}
function parseOptionalStringArray(value, source, field) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) {
    throw new Error(`'${field}' in ${source} must be an array of strings.`);
  }
  return value.map(
    (entry, index) => parseString(entry, source, `${field}[${index}]`)
  );
}
function parseOptionalBoolean(value, source, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "boolean") {
    throw new Error(`'${field}' in ${source} must be a boolean.`);
  }
  return value;
}
function parseOptionalString(value, source, field) {
  if (value === void 0) return void 0;
  return parseString(value, source, field);
}
function parseString(value, source, field) {
  if (typeof value !== "string") {
    throw new Error(`'${field}' in ${source} must be a string.`);
  }
  return value;
}
function parseOptionalInteger(value, source, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`'${field}' in ${source} must be a positive integer.`);
  }
  return value;
}
function parseOptionalNonNegativeInteger(value, source, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`'${field}' in ${source} must be a non-negative integer.`);
  }
  return value;
}
function parseOptionalLiteral(value, source, field, allowed) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`
    );
  }
  return value;
}
function parseLiteral(value, source, field, allowed) {
  const parsed = parseOptionalLiteral(value, source, field, allowed);
  if (parsed === void 0) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`
    );
  }
  return parsed;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/execution-policy.ts
var DEFAULT_RESEARCH_POLL_INTERVAL_MS = 3e3;
var MAX_RETRY_DELAY_MS = 3e4;
var RequestTimeoutError = class extends Error {
  name = "RequestTimeoutError";
};
var NonResumableResearchError = class extends Error {
  name = "NonResumableResearchError";
};
function stripLocalExecutionOptions(options) {
  if (!options) {
    return void 0;
  }
  const {
    requestTimeoutMs: _requestTimeoutMs,
    retryCount: _retryCount,
    retryDelayMs: _retryDelayMs,
    pollIntervalMs: _pollIntervalMs,
    timeoutMs: _timeoutMs,
    maxConsecutivePollErrors: _maxConsecutivePollErrors,
    resumeId: _resumeId,
    resumeInteractionId: _resumeInteractionId,
    ...rest
  } = options;
  return Object.keys(rest).length > 0 ? rest : void 0;
}
function parseLocalExecutionOptions(options) {
  return {
    requestTimeoutMs: parseOptionalPositiveIntegerOption(
      options,
      "requestTimeoutMs"
    ),
    retryCount: parseOptionalNonNegativeIntegerOption(options, "retryCount"),
    retryDelayMs: parseOptionalPositiveIntegerOption(options, "retryDelayMs"),
    pollIntervalMs: parseOptionalPositiveIntegerOption(
      options,
      "pollIntervalMs"
    ),
    timeoutMs: parseOptionalPositiveIntegerOption(options, "timeoutMs"),
    maxConsecutivePollErrors: parseOptionalPositiveIntegerOption(
      options,
      "maxConsecutivePollErrors"
    ),
    resumeId: parseOptionalNonEmptyStringOption(options, "resumeId")
  };
}
function resolveRequestExecutionPolicy(options, defaults) {
  const localOptions = parseLocalExecutionOptions(options);
  return {
    requestTimeoutMs: localOptions.requestTimeoutMs ?? defaults?.requestTimeoutMs,
    retryCount: localOptions.retryCount ?? defaults?.retryCount ?? 0,
    retryDelayMs: localOptions.retryDelayMs ?? defaults?.retryDelayMs ?? 2e3
  };
}
function resolveResearchExecutionPolicy(options, defaults) {
  const localOptions = parseLocalExecutionOptions(options);
  const request = resolveRequestExecutionPolicy(options, defaults);
  return {
    ...request,
    pollIntervalMs: localOptions.pollIntervalMs ?? defaults?.researchPollIntervalMs ?? DEFAULT_RESEARCH_POLL_INTERVAL_MS,
    timeoutMs: localOptions.timeoutMs ?? defaults?.researchTimeoutMs,
    maxConsecutivePollErrors: localOptions.maxConsecutivePollErrors ?? defaults?.researchMaxConsecutivePollErrors ?? 3,
    resumeId: localOptions.resumeId
  };
}
async function runWithExecutionPolicy(label, operation, policy, context) {
  const maxAttempts = Math.max(1, policy.retryCount + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(context.signal);
    const {
      context: attemptContext,
      abort,
      cleanup
    } = createAttemptContext(context);
    try {
      const result = operation(attemptContext);
      const timeoutMessage = policy.requestTimeoutMs === void 0 ? void 0 : `${label} timed out after ${formatDuration(policy.requestTimeoutMs)}.`;
      return await withAbortAndOptionalTimeout(
        result,
        policy.requestTimeoutMs,
        context.signal,
        timeoutMessage,
        timeoutMessage ? () => abort(new RequestTimeoutError(timeoutMessage)) : void 0
      );
    } catch (error) {
      if (!shouldRetryError(error, policy) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = Math.min(
        policy.retryDelayMs * 2 ** (attempt - 1),
        MAX_RETRY_DELAY_MS
      );
      context.onProgress?.(
        `${label} failed (${formatErrorMessage(error)}). Retrying in ${formatDuration(delayMs)} (attempt ${attempt + 1}/${maxAttempts}).`
      );
      await sleep(delayMs, context.signal);
    } finally {
      cleanup();
    }
  }
  throw new Error(`${label} failed.`);
}
async function executeResearchWithLifecycle({
  providerLabel,
  providerId,
  context,
  policy,
  startRetryCount = 0,
  startRetryNotice,
  startIdempotencyKey,
  startRetryOnTimeout = false,
  startRequestTimeoutMs,
  pollRequestTimeoutMs,
  start,
  poll
}) {
  const effectiveStartRequestTimeoutMs = startRequestTimeoutMs === void 0 ? policy.requestTimeoutMs : startRequestTimeoutMs ?? void 0;
  const effectivePollRequestTimeoutMs = pollRequestTimeoutMs === void 0 ? policy.requestTimeoutMs : pollRequestTimeoutMs ?? void 0;
  const timeoutMessage = policy.timeoutMs === void 0 ? void 0 : `${providerLabel} research exceeded ${formatDuration(policy.timeoutMs)}.`;
  let lastStatus;
  let lifecycleStartedAt = Date.now();
  let lifecycleSignal = context.signal;
  let cleanupLifecycle = () => {
  };
  let lifecycleContext = {
    ...context,
    signal: lifecycleSignal
  };
  const activateLifecycleDeadline = () => {
    const deadline = createDeadlineSignal(
      context.signal,
      policy.timeoutMs,
      timeoutMessage
    );
    lifecycleSignal = deadline.signal;
    cleanupLifecycle = deadline.cleanup;
    lifecycleStartedAt = Date.now();
    lifecycleContext = {
      ...context,
      signal: lifecycleSignal
    };
  };
  let jobId = policy.resumeId;
  activateLifecycleDeadline();
  try {
    if (jobId) {
      lifecycleContext.onProgress?.(
        `Resuming ${providerLabel} research: ${jobId}`
      );
    } else {
      lifecycleContext.onProgress?.(`Starting ${providerLabel} research`);
      if (startRetryNotice) {
        lifecycleContext.onProgress?.(startRetryNotice);
      }
      const job = await runWithExecutionPolicy(
        `${providerLabel} research start`,
        (attemptContext) => start({
          ...attemptContext,
          idempotencyKey: startIdempotencyKey
        }),
        {
          ...policy,
          requestTimeoutMs: effectiveStartRequestTimeoutMs,
          retryCount: startRetryCount,
          retryOnTimeout: startRetryOnTimeout
        },
        lifecycleContext
      );
      jobId = job.id;
      lifecycleContext.onProgress?.(
        `${providerLabel} research started: ${jobId}`
      );
    }
    if (!jobId) {
      throw new Error(`${providerLabel} research did not return a job id.`);
    }
    let consecutivePollErrors = 0;
    while (true) {
      throwIfAborted(
        lifecycleContext.signal,
        `${providerLabel} research aborted.`
      );
      try {
        const result = await runWithExecutionPolicy(
          `${providerLabel} research poll`,
          (attemptContext) => poll(jobId, attemptContext),
          {
            ...policy,
            requestTimeoutMs: effectivePollRequestTimeoutMs
          },
          lifecycleContext
        );
        consecutivePollErrors = 0;
        if (result.status !== lastStatus) {
          lifecycleContext.onProgress?.(
            `${providerLabel} research status: ${result.status} (${formatElapsed(Date.now() - lifecycleStartedAt)} elapsed)`
          );
          lastStatus = result.status;
        }
        if (result.status === "completed") {
          return result.output ?? {
            provider: providerId,
            text: `${providerLabel} research completed without textual output.`,
            summary: `Research via ${providerLabel}`
          };
        }
        if (result.status === "failed" || result.status === "cancelled") {
          throw new NonResumableResearchError(
            result.error || `${providerLabel} research ${result.status}.`
          );
        }
      } catch (error) {
        if (error instanceof NonResumableResearchError) {
          throw error;
        }
        if (isAbortErrorFromSignal(lifecycleContext.signal, error)) {
          throw error;
        }
        if (!(error instanceof RequestTimeoutError) && !isRetryableError(error)) {
          throw normalizeError(error);
        }
        consecutivePollErrors += 1;
        if (consecutivePollErrors >= policy.maxConsecutivePollErrors) {
          throw buildResumeError(
            `${providerLabel} research polling failed too many times in a row: ${formatErrorMessage(error)}`,
            jobId
          );
        }
        lifecycleContext.onProgress?.(
          `${providerLabel} research poll is still retrying after transient errors (${consecutivePollErrors}/${policy.maxConsecutivePollErrors} consecutive poll failures). Background job id: ${jobId}`
        );
      }
      await sleep(policy.pollIntervalMs, lifecycleContext.signal);
    }
  } catch (error) {
    if (isAbortErrorFromSignal(lifecycleContext.signal, error)) {
      if (jobId) {
        throw buildResumeError(error, jobId);
      }
      if (error instanceof RequestTimeoutError) {
        throw buildUnknownResearchStartError(error);
      }
    }
    throw error;
  } finally {
    cleanupLifecycle();
  }
}
function shouldRetryError(error, policy) {
  if (error instanceof RequestTimeoutError) {
    return policy.retryOnTimeout === true;
  }
  return isRetryableError(error);
}
function isRetryableError(error) {
  if (error instanceof RequestTimeoutError) {
    return false;
  }
  const message = formatErrorMessage(error).toLowerCase();
  if (!message || message === "operation aborted.") {
    return false;
  }
  return /429|500|502|503|504|deadline exceeded|econnreset|ecanceled|ehostunreach|eai_again|enotfound|etimedout|fetch failed|gateway timeout|internal error|network|overloaded|rate limit|resource exhausted|socket hang up|temporarily unavailable|timeout|unavailable/.test(
    message
  );
}
function formatErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${totalSeconds}s`;
}
function formatDuration(ms) {
  if (ms >= 6e4) {
    return formatElapsed(ms);
  }
  if (ms >= 1e3) {
    return `${Math.floor(ms / 1e3)}s`;
  }
  return `${ms}ms`;
}
async function sleep(ms, signal) {
  throwIfAborted(signal);
  await new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(getAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function throwIfAborted(signal, message = "Operation aborted.") {
  if (signal?.aborted) {
    throw getAbortError(signal, message);
  }
}
function createAttemptContext(context) {
  const controller = new AbortController();
  if (context.signal?.aborted) {
    controller.abort(getAbortError(context.signal));
  }
  const onAbort = () => {
    controller.abort(getAbortError(context.signal));
  };
  context.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    context: {
      ...context,
      signal: controller.signal
    },
    abort: (reason) => controller.abort(reason),
    cleanup: () => context.signal?.removeEventListener("abort", onAbort)
  };
}
async function withAbortAndOptionalTimeout(promise, timeoutMs, signal, message, onTimeout) {
  if (timeoutMs === void 0 && !signal) {
    return await promise;
  }
  throwIfAborted(signal);
  return await new Promise((resolve2, reject) => {
    const timer = timeoutMs === void 0 ? void 0 : setTimeout(() => {
      onTimeout?.();
      cleanup();
      reject(
        new RequestTimeoutError(
          message ?? `Operation timed out after ${formatDuration(timeoutMs)}.`
        )
      );
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(getAbortError(signal));
    };
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve2(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
function getAbortError(signal, message = "Operation aborted.") {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.length > 0) {
    return new Error(reason);
  }
  return new Error(message);
}
function isAbortErrorFromSignal(signal, error) {
  return signal?.aborted === true && signal.reason === error;
}
function createDeadlineSignal(signal, timeoutMs, timeoutMessage) {
  if (timeoutMs === void 0) {
    return {
      signal,
      cleanup: () => {
      }
    };
  }
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort(getAbortError(signal));
  }
  const onAbort = () => {
    controller.abort(getAbortError(signal));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(
      new RequestTimeoutError(
        timeoutMessage ?? `Operation timed out after ${formatDuration(timeoutMs)}.`
      )
    );
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}
function buildResumeError(error, jobId) {
  const message = typeof error === "string" ? error : formatErrorMessage(error);
  return new Error(
    `${message} Resume the background job with options.resumeId=${JSON.stringify(jobId)}.`
  );
}
function buildUnknownResearchStartError(error) {
  const message = typeof error === "string" ? error : formatErrorMessage(error);
  return new Error(
    `${message} The provider may still create a background job, but no job id was returned so this run cannot be resumed automatically.`
  );
}
function normalizeError(error) {
  return error instanceof Error ? error : new Error(formatErrorMessage(error));
}
function parseOptionalPositiveIntegerOption(options, key) {
  const value = options?.[key];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`options.${key} must be a positive integer.`);
  }
  return value;
}
function parseOptionalNonNegativeIntegerOption(options, key) {
  const value = options?.[key];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`options.${key} must be a non-negative integer.`);
  }
  return value;
}
function parseOptionalNonEmptyStringOption(options, key) {
  const value = options?.[key];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`options.${key} must be a non-empty string.`);
  }
  return value;
}

// src/prefetch-manager.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/content-store.ts
import { createHash } from "node:crypto";
var MemoryContentStore = class {
  entries = /* @__PURE__ */ new Map();
  clear() {
    this.entries.clear();
  }
  async get(key) {
    return this.entries.get(key);
  }
  async put(entry) {
    this.entries.set(entry.key, entry);
  }
  async delete(key) {
    this.entries.delete(key);
  }
  async listByKind(kind) {
    const result = [];
    for (const entry of this.entries.values()) {
      if (entry.kind === kind) {
        result.push(entry);
      }
    }
    return result;
  }
  async cleanup(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== void 0 && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
};
function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}
function createStoreKey(parts) {
  return parts.map((part) => String(part)).join(":");
}

// src/providers/claude.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname as dirname2, extname, join as join2 } from "node:path";
import {
  query
} from "@anthropic-ai/claude-agent-sdk";

// src/provider-plans.ts
function createSilentForegroundPlan({
  config,
  traits,
  ...plan
}) {
  return buildSinglePlan("silent-foreground", config.policy, traits, plan);
}
function createStreamingForegroundPlan({
  config,
  traits,
  ...plan
}) {
  return buildSinglePlan("streaming-foreground", config.policy, traits, plan);
}
function createBackgroundResearchPlan({
  config,
  traits,
  ...plan
}) {
  const builtTraits = buildTraits(config.policy, traits);
  return {
    ...plan,
    deliveryMode: "background-research",
    ...builtTraits ? { traits: builtTraits } : {}
  };
}
function buildSinglePlan(deliveryMode, policyDefaults, traits, plan) {
  const builtTraits = buildTraits(policyDefaults, traits);
  return {
    ...plan,
    deliveryMode,
    ...builtTraits ? { traits: builtTraits } : {}
  };
}
function buildTraits(policyDefaults, traits) {
  const builtTraits = {
    ...policyDefaults ? { policyDefaults } : {},
    ...traits ?? {}
  };
  return Object.keys(builtTraits).length > 0 ? builtTraits : void 0;
}

// src/providers/shared.ts
function trimSnippet(input, maxLength = 300) {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}\u2026`;
}
function normalizeContentText(input) {
  const text = (input ?? "").replace(/\r/g, "").trim();
  if (!text) {
    return "";
  }
  return text.split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n");
}
function pushIndentedBlock(lines, text) {
  const normalized = normalizeContentText(text);
  if (!normalized) {
    return;
  }
  for (const line of normalized.split("\n")) {
    lines.push(`   ${line}`);
  }
}
function asJsonObject(value) {
  return value ? { ...value } : {};
}
function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

// src/providers/claude.ts
var require2 = createRequire(import.meta.url);
var SEARCH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" }
        },
        required: ["title", "url", "snippet"]
      }
    }
  },
  required: ["sources"]
};
var ANSWER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" }
        },
        required: ["title", "url"]
      }
    }
  },
  required: ["answer", "sources"]
};
var ClaudeProvider = class {
  id = "claude";
  label = "Claude";
  docsUrl = "https://github.com/anthropics/claude-agent-sdk-typescript";
  capabilities = ["search", "answer"];
  createTemplate() {
    return {
      enabled: false
    };
  }
  getStatus(config, _cwd) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const executablePath = resolveClaudeExecutablePath(config);
    if (executablePath && !existsSync(executablePath)) {
      return { available: false, summary: "missing Claude Code executable" };
    }
    const authStatus = getClaudeAuthStatus(executablePath);
    if (!authStatus.loggedIn) {
      return { available: false, summary: "missing Claude auth" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(queryText, maxResults, options, config, context) {
    const output = parseClaudeSearchOutput(
      await this.runStructuredQuery({
        prompt: [
          "You are performing web research for another coding agent.",
          "Use the WebSearch tool to search the public web.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          `Return at most ${maxResults} sources.`,
          "Each snippet should be short, factual, and specific to the result.",
          "Prefer primary or official sources when they are available.",
          "",
          `User query: ${queryText}`
        ].join("\n"),
        schema: SEARCH_OUTPUT_SCHEMA,
        tools: ["WebSearch"],
        config,
        context,
        options
      })
    );
    return {
      provider: this.id,
      results: output.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet)
      }))
    };
  }
  async answer(queryText, options, config, context) {
    const output = parseClaudeAnswerOutput(
      await this.runStructuredQuery({
        prompt: [
          "Answer the user's question using current public web information.",
          "Use WebSearch to find relevant sources and WebFetch when you need to verify important details.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          "Keep the answer concise but informative.",
          "Only cite sources you actually used.",
          "",
          `User query: ${queryText}`
        ].join("\n"),
        schema: ANSWER_OUTPUT_SCHEMA,
        tools: ["WebSearch", "WebFetch"],
        config,
        context,
        options
      })
    );
    const lines = [];
    lines.push(output.answer.trim() || "No answer returned.");
    if (output.sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of output.sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Claude with ${output.sources.length} source(s)`,
      itemCount: output.sources.length
    };
  }
  async runStructuredQuery({
    prompt,
    schema,
    tools,
    config,
    context,
    options
  }) {
    const abortController = new AbortController();
    if (context.signal?.aborted) {
      abortController.abort(context.signal.reason);
    }
    const onAbort = () => {
      abortController.abort(context.signal?.reason);
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const stream = query({
      prompt,
      options: {
        abortController,
        allowedTools: tools,
        cwd: context.cwd,
        ...getClaudeRuntimeOptions(config, options),
        outputFormat: {
          type: "json_schema",
          schema
        },
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
        persistSession: false,
        permissionMode: "dontAsk",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Use only the provided web tools. Always produce output that matches the requested JSON schema exactly."
        },
        tools
      }
    });
    const seenToolUseIds = /* @__PURE__ */ new Set();
    let finalResult;
    try {
      for await (const message of stream) {
        handleProgressMessage(message, seenToolUseIds, context.onProgress);
        if (message.type === "result") {
          finalResult = message;
        }
      }
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
      stream.close();
    }
    if (!finalResult) {
      throw new Error("Claude returned no result.");
    }
    if (finalResult.subtype !== "success") {
      throw new Error(
        finalResult.errors.join("\n") || `Claude query failed (${finalResult.subtype}).`
      );
    }
    return parseStructuredOutput(finalResult);
  }
};
var CLAUDE_AUTH_CACHE_TTL_MS = 5e3;
var defaultClaudeExecutablePath;
var claudeAuthStatusCache = /* @__PURE__ */ new Map();
function resolveClaudeExecutablePath(config) {
  if (config.pathToClaudeCodeExecutable) {
    return config.pathToClaudeCodeExecutable;
  }
  if (defaultClaudeExecutablePath !== void 0) {
    return defaultClaudeExecutablePath;
  }
  try {
    const sdkEntryPath = require2.resolve("@anthropic-ai/claude-agent-sdk");
    defaultClaudeExecutablePath = join2(dirname2(sdkEntryPath), "cli.js");
  } catch {
    defaultClaudeExecutablePath = void 0;
  }
  return defaultClaudeExecutablePath;
}
function getClaudeAuthStatus(executablePath) {
  if (!executablePath) {
    return { loggedIn: false };
  }
  const cachedStatus = claudeAuthStatusCache.get(executablePath);
  if (cachedStatus && Date.now() - cachedStatus.checkedAt < CLAUDE_AUTH_CACHE_TTL_MS) {
    return { loggedIn: cachedStatus.loggedIn };
  }
  const [command, ...args] = getClaudeAuthCommand(executablePath);
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return cacheClaudeAuthStatus(executablePath, parseClaudeAuthStatus(stdout));
  } catch (error) {
    const stdout = getExecOutput(
      error.stdout
    );
    if (stdout) {
      return cacheClaudeAuthStatus(
        executablePath,
        parseClaudeAuthStatus(stdout)
      );
    }
    return cacheClaudeAuthStatus(executablePath, { loggedIn: false });
  }
}
function cacheClaudeAuthStatus(executablePath, status) {
  claudeAuthStatusCache.set(executablePath, {
    ...status,
    checkedAt: Date.now()
  });
  return status;
}
function getClaudeAuthCommand(executablePath) {
  const extension = extname(executablePath);
  if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
    return [process.execPath, executablePath, "auth", "status", "--json"];
  }
  return [executablePath, "auth", "status", "--json"];
}
function getExecOutput(output) {
  if (typeof output === "string") {
    return output;
  }
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }
  return "";
}
function parseClaudeAuthStatus(raw) {
  try {
    const parsed = JSON.parse(raw);
    return { loggedIn: parsed.loggedIn === true };
  } catch {
    return { loggedIn: false };
  }
}
function handleProgressMessage(message, seenToolUseIds, onProgress) {
  if (!onProgress || message.type !== "tool_progress") {
    return;
  }
  if (seenToolUseIds.has(message.tool_use_id)) {
    return;
  }
  seenToolUseIds.add(message.tool_use_id);
  onProgress(formatToolProgressMessage(message.tool_name));
}
function formatToolProgressMessage(toolName) {
  if (toolName === "WebSearch") return "Searching via Claude";
  if (toolName === "WebFetch") return "Fetching via Claude";
  return `Claude: ${toolName}`;
}
function parseStructuredOutput(result) {
  if (result.subtype !== "success") {
    throw new Error("Claude query did not succeed.");
  }
  if (result.structured_output !== void 0) {
    return result.structured_output;
  }
  if (!result.result.trim()) {
    throw new Error("Claude returned an empty response.");
  }
  try {
    return JSON.parse(result.result);
  } catch {
    const match = result.result.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Claude returned invalid JSON output.");
    }
    return JSON.parse(match[0]);
  }
}
function getClaudeRuntimeOptions(config, options) {
  const native = config.native ?? config.defaults;
  const model = readNonEmptyString(options?.model) ?? native?.model;
  const effort = readEnum(options?.effort, ["low", "medium", "high", "max"]);
  const maxTurns = readPositiveInteger(options?.maxTurns);
  const maxThinkingTokens = readNonNegativeInteger(options?.maxThinkingTokens);
  const maxBudgetUsd = readPositiveNumber(options?.maxBudgetUsd);
  const thinking = isPlainObject2(options?.thinking) ? options?.thinking : void 0;
  return {
    ...model ? { model } : {},
    ...effort ?? native?.effort ? { effort: effort ?? native?.effort } : {},
    ...maxTurns ?? native?.maxTurns ? { maxTurns: maxTurns ?? native?.maxTurns } : {},
    ...maxThinkingTokens !== void 0 ? { maxThinkingTokens } : {},
    ...maxBudgetUsd !== void 0 ? { maxBudgetUsd } : {},
    ...thinking ? { thinking } : {}
  };
}
function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
}
function readPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function readEnum(value, values) {
  return typeof value === "string" && values.includes(value) ? value : void 0;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseClaudeSearchOutput(value) {
  const sources = readArray(value, "sources").map((entry) => ({
    title: readString(entry, "title"),
    url: readString(entry, "url"),
    snippet: readString(entry, "snippet")
  }));
  return { sources };
}
function parseClaudeAnswerOutput(value) {
  return {
    answer: readString(value, "answer"),
    sources: readArray(value, "sources").map((entry) => ({
      title: readString(entry, "title"),
      url: readString(entry, "url")
    }))
  };
}
function readArray(value, key) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`Claude output is missing '${key}'.`);
  }
  const entry = value[key];
  if (!Array.isArray(entry)) {
    throw new Error(`Claude output field '${key}' must be an array.`);
  }
  return entry;
}
function readString(value, key) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`Claude output is missing '${key}'.`);
  }
  const entry = value[key];
  if (typeof entry !== "string") {
    throw new Error(`Claude output field '${key}' must be a string.`);
  }
  return entry;
}

// src/providers/cloudflare.ts
var CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts/{accountId}/browser-rendering/markdown";
var CloudflareProvider = class {
  id = "cloudflare";
  label = "Cloudflare";
  docsUrl = "https://developers.cloudflare.com/browser-rendering/rest-api/";
  capabilities = ["contents"];
  createTemplate() {
    return {
      enabled: false,
      apiToken: "CLOUDFLARE_API_TOKEN",
      accountId: "CLOUDFLARE_ACCOUNT_ID"
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiToken = resolveConfigValue(config.apiToken);
    if (!apiToken) {
      return { available: false, summary: "missing apiToken" };
    }
    const accountId = resolveConfigValue(config.accountId);
    if (!accountId) {
      return { available: false, summary: "missing accountId" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    if (request.capability !== "contents") {
      return null;
    }
    return createSilentForegroundPlan({
      config,
      capability: request.capability,
      providerId: this.id,
      providerLabel: this.label,
      execute: (context) => this.contents(request.urls, config, context)
    });
  }
  async contents(urls, config, context) {
    const apiToken = resolveConfigValue(config.apiToken);
    if (!apiToken) {
      throw new Error("Cloudflare is missing an API token.");
    }
    const accountId = resolveConfigValue(config.accountId);
    if (!accountId) {
      throw new Error("Cloudflare is missing an account ID.");
    }
    const endpoint = CF_API_BASE.replace("{accountId}", accountId);
    const timeoutMs = config.native?.requestTimeoutMs ?? 3e4;
    context.onProgress?.(
      `Fetching contents from Cloudflare for ${urls.length} URL(s)`
    );
    const lines = [];
    const contentsEntries = [];
    let successCount = 0;
    for (const url of urls) {
      context.onProgress?.(`Fetching: ${url}`);
      try {
        const controller = new AbortController();
        const combinedSignal = context.signal ? anySignal([context.signal, controller.signal]) : controller.signal;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`
          },
          body: JSON.stringify({ url }),
          signal: combinedSignal
        });
        clearTimeout(timer);
        const json = await response.json();
        if (json.success && json.result) {
          const body = normalizeContentText(json.result);
          const title = extractTitleFromMarkdown(json.result) ?? url;
          const entryLines = [
            `${successCount + 1}. ${title}`,
            `   ${url}`
          ];
          pushIndentedBlock(entryLines, body);
          lines.push(...entryLines, "");
          contentsEntries.push({
            url,
            title,
            body,
            summary: "1 content result via Cloudflare",
            status: "ready"
          });
          successCount++;
        } else {
          const errorMessage = json.errors?.[0]?.message ?? `HTTP ${response.status}`;
          lines.push(`Error: ${url}`, `   ${errorMessage}`, "");
          contentsEntries.push({
            url,
            title: url,
            body: errorMessage,
            status: "failed"
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        lines.push(`Error: ${url}`, `   ${message}`, "");
        contentsEntries.push({
          url,
          title: url,
          body: message,
          status: "failed"
        });
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents extracted.",
      summary: `${successCount} of ${urls.length} URL(s) extracted via Cloudflare`,
      itemCount: successCount,
      metadata: {
        contentsEntries
      }
    };
  }
};
function extractTitleFromMarkdown(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : void 0;
}
function anySignal(signals) {
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true
    });
  }
  return controller.signal;
}

// src/providers/codex.ts
import { existsSync as existsSync2 } from "node:fs";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
import { Codex } from "@openai/codex-sdk";
var OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" }
        },
        required: ["title", "url", "snippet"]
      }
    }
  },
  required: ["sources"]
};
var CodexProvider = class {
  id = "codex";
  label = "Codex";
  docsUrl = "https://github.com/openai/codex/tree/main/sdk/typescript";
  capabilities = ["search"];
  createTemplate() {
    return {
      enabled: true,
      native: {
        networkAccessEnabled: true,
        webSearchEnabled: true,
        webSearchMode: "live"
      }
    };
  }
  getStatus(config, _cwd) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    try {
      new Codex({
        codexPathOverride: config.codexPath,
        config: config.config
      });
    } catch (error) {
      return {
        available: false,
        summary: error.message
      };
    }
    if (!hasCodexCredentials(config)) {
      return { available: false, summary: "missing Codex auth" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    if (request.capability !== "search") {
      return null;
    }
    return createSilentForegroundPlan({
      config,
      capability: request.capability,
      providerId: this.id,
      providerLabel: this.label,
      execute: (context) => this.search(
        request.query,
        request.maxResults,
        request.options,
        config,
        context
      )
    });
  }
  async search(query2, maxResults, options, config, context) {
    const codex = new Codex({
      codexPathOverride: config.codexPath,
      baseUrl: config.baseUrl,
      apiKey: resolveConfigValue(config.apiKey),
      config: config.config,
      env: resolveEnvMap(config.env)
    });
    const thread = codex.startThread(
      buildCodexSearchThreadOptions(config, context.cwd, options)
    );
    const prompt = [
      "You are performing web research for another coding agent.",
      "Search the public web and return only a JSON object matching the provided schema.",
      "Do not include markdown fences or extra commentary.",
      `Return at most ${maxResults} sources.`,
      "Prefer primary or official sources when they are available.",
      "Each snippet should be short and specific.",
      "",
      `User query: ${query2}`
    ].join("\n");
    const streamed = await thread.runStreamed(prompt, {
      outputSchema: OUTPUT_SCHEMA,
      signal: context.signal
    });
    let finalResponse = "";
    const seenQueries = /* @__PURE__ */ new Set();
    for await (const event of streamed.events) {
      handleProgressEvent(event, seenQueries, context.onProgress);
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
    }
    const parsed = parseOutput(finalResponse);
    return {
      provider: this.id,
      results: parsed.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet)
      }))
    };
  }
};
function buildCodexSearchThreadOptions(config, cwd, options) {
  const runtimeOptions = getCodexSearchRuntimeOptions(options);
  const native = config.native ?? config.defaults;
  return {
    additionalDirectories: native?.additionalDirectories,
    approvalPolicy: "never",
    model: runtimeOptions.model ?? native?.model,
    modelReasoningEffort: runtimeOptions.modelReasoningEffort ?? native?.modelReasoningEffort,
    networkAccessEnabled: native?.networkAccessEnabled ?? true,
    sandboxMode: "read-only",
    skipGitRepoCheck: true,
    webSearchEnabled: native?.webSearchEnabled ?? true,
    webSearchMode: runtimeOptions.webSearchMode ?? native?.webSearchMode ?? "live",
    workingDirectory: cwd
  };
}
function getCodexSearchRuntimeOptions(options) {
  if (!options) {
    return {};
  }
  const model = readNonEmptyString2(options.model);
  const modelReasoningEffort = readEnum2(options.modelReasoningEffort, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh"
  ]);
  const webSearchMode = readEnum2(options.webSearchMode, [
    "disabled",
    "cached",
    "live"
  ]);
  return {
    ...model ? { model } : {},
    ...modelReasoningEffort ? { modelReasoningEffort } : {},
    ...webSearchMode ? { webSearchMode } : {}
  };
}
function readNonEmptyString2(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function readEnum2(value, values) {
  return typeof value === "string" && values.includes(value) ? value : void 0;
}
function hasCodexCredentials(config) {
  if (hasConfiguredReference(config.apiKey)) {
    return true;
  }
  if (hasConfiguredReference(config.env?.CODEX_API_KEY) || hasConfiguredReference(config.env?.OPENAI_API_KEY)) {
    return true;
  }
  if (!config.env) {
    const inheritedKey = process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY;
    if (typeof inheritedKey === "string" && inheritedKey.trim().length > 0) {
      return true;
    }
  }
  return existsSync2(join3(homedir(), ".codex", "auth.json"));
}
function hasConfiguredReference(reference) {
  if (!reference) {
    return false;
  }
  if (reference.startsWith("!")) {
    return reference.slice(1).trim().length > 0;
  }
  const envValue = process.env[reference];
  if (typeof envValue === "string") {
    return envValue.trim().length > 0;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    return false;
  }
  return reference.trim().length > 0;
}
function handleProgressEvent(event, seenQueries, onProgress) {
  if (!onProgress) return;
  if (event.type === "item.completed" && event.item.type === "web_search" && !seenQueries.has(event.item.query)) {
    seenQueries.add(event.item.query);
    onProgress(`Searching Codex for: ${event.item.query}`);
  }
}
function parseOutput(raw) {
  if (!raw.trim()) {
    throw new Error("Codex returned an empty response.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Codex returned invalid JSON output.");
    }
    return JSON.parse(match[0]);
  }
}

// src/providers/cli-json.ts
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
async function runCliJsonCommand({
  command,
  payload,
  context,
  label
}) {
  const argv = normalizeArgv(command);
  const cwd = resolveCommandCwd(command.cwd, context.cwd);
  const env = {
    ...process.env,
    ...resolveEnvMap(command.env) ?? {}
  };
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stderrBuffer = "";
    let abortTimer;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      rejectPromise(error);
    };
    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };
    const emitProgressLine = (line) => {
      const message = line.trim();
      if (message.length > 0) {
        context.onProgress?.(message);
      }
    };
    const flushStderrBuffer = () => {
      if (stderrBuffer.trim().length > 0) {
        emitProgressLine(stderrBuffer);
      }
      stderrBuffer = "";
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      abortTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1e3);
    };
    if (context.signal?.aborted) {
      onAbort();
    } else {
      context.signal?.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        emitProgressLine(line);
      }
    });
    child.on("error", (error) => {
      rejectOnce(
        new Error(
          `${label} failed to start: ${error.message || String(error)}`
        )
      );
    });
    child.on("close", (code, signal) => {
      flushStderrBuffer();
      if (context.signal?.aborted) {
        rejectOnce(new Error(`${label} was aborted.`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code ?? "unknown"}`;
        rejectOnce(
          new Error(
            signal ? `${label} exited via signal ${signal}: ${detail}` : `${label} failed with exit code ${code}: ${detail}`
          )
        );
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        rejectOnce(new Error(`${label} did not write JSON to stdout.`));
        return;
      }
      try {
        resolveOnce(JSON.parse(trimmed));
      } catch (error) {
        rejectOnce(
          new Error(
            `${label} returned invalid JSON: ${error.message}`
          )
        );
      }
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(`${JSON.stringify(payload)}
`);
  });
}
function normalizeArgv(command) {
  const argv = command.argv?.filter((entry) => entry.trim().length > 0) ?? [];
  if (argv.length === 0) {
    throw new Error("Custom CLI command is missing argv.");
  }
  return argv;
}
function resolveCommandCwd(commandCwd, fallbackCwd) {
  if (!commandCwd || commandCwd.trim().length === 0) {
    return fallbackCwd;
  }
  return isAbsolute(commandCwd) ? commandCwd : resolve(fallbackCwd, commandCwd);
}

// src/providers/custom-cli.ts
var CustomCliProvider = class {
  id = "custom-cli";
  label = "Custom CLI";
  docsUrl = "https://github.com/mavam/pi-web-providers#custom-cli-provider";
  capabilities = ["search", "contents", "answer", "research"];
  createTemplate() {
    return {
      enabled: false
    };
  }
  getStatus(config, _cwd, capability) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    if (capability) {
      return hasCommandForCapability(config, capability) ? { available: true, summary: "enabled" } : {
        available: false,
        summary: `no command configured for ${capability}`
      };
    }
    return hasAnyCommand(config) ? { available: true, summary: "enabled" } : { available: false, summary: "no commands configured" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.contents(request.urls, request.options, config, context)
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      case "research":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.research(request.input, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, options, config, context) {
    const output = await this.runCommand({
      capability: "search",
      payload: {
        capability: "search",
        query: query2,
        maxResults,
        ...options ? { options } : {}
      },
      config,
      context
    });
    return parseSearchResponse(output, this.id);
  }
  async contents(urls, options, config, context) {
    const output = await this.runCommand({
      capability: "contents",
      payload: {
        capability: "contents",
        urls,
        ...options ? { options } : {}
      },
      config,
      context
    });
    return parseProviderToolOutput(output, this.id);
  }
  async answer(query2, options, config, context) {
    const output = await this.runCommand({
      capability: "answer",
      payload: {
        capability: "answer",
        query: query2,
        ...options ? { options } : {}
      },
      config,
      context
    });
    return parseProviderToolOutput(output, this.id);
  }
  async research(input, options, config, context) {
    const output = await this.runCommand({
      capability: "research",
      payload: {
        capability: "research",
        input,
        ...options ? { options } : {}
      },
      config,
      context
    });
    return parseProviderToolOutput(output, this.id);
  }
  async runCommand({
    capability,
    payload,
    config,
    context
  }) {
    const command = getCommandConfig(config, capability);
    if (!command) {
      throw new Error(
        `Custom CLI has no command configured for ${capability}.`
      );
    }
    context.onProgress?.(`Running Custom CLI ${capability}`);
    return await runCliJsonCommand({
      command,
      payload: {
        ...payload,
        cwd: context.cwd
      },
      context,
      label: `Custom CLI ${capability}`
    });
  }
};
function getCommandConfig(config, capability) {
  return config.native?.[capability] ?? config.defaults?.[capability];
}
function hasCommandForCapability(config, capability) {
  return normalizeConfiguredArgv(getCommandConfig(config, capability)).length > 0;
}
function hasAnyCommand(config) {
  return hasCommandForCapability(config, "search") || hasCommandForCapability(config, "contents") || hasCommandForCapability(config, "answer") || hasCommandForCapability(config, "research");
}
function normalizeConfiguredArgv(command) {
  return command?.argv?.filter((entry) => entry.trim().length > 0) ?? [];
}
function parseSearchResponse(value, providerId) {
  if (!isJsonObject(value)) {
    throw new Error("Custom CLI search output must be a JSON object.");
  }
  if (!Array.isArray(value.results)) {
    throw new Error("Custom CLI search output must include a 'results' array.");
  }
  return {
    provider: providerId,
    results: value.results.map(
      (entry, index) => parseSearchResult(entry, index)
    )
  };
}
function parseSearchResult(entry, index) {
  if (!isJsonObject(entry)) {
    throw new Error(
      `Custom CLI search result at index ${index} must be a JSON object.`
    );
  }
  return {
    title: readRequiredString(entry.title, `results[${index}].title`),
    url: readRequiredString(entry.url, `results[${index}].url`),
    snippet: readRequiredString(entry.snippet, `results[${index}].snippet`),
    ...typeof entry.score === "number" ? { score: entry.score } : {},
    ...isJsonObject(entry.metadata) ? { metadata: entry.metadata } : {}
  };
}
function parseProviderToolOutput(value, providerId) {
  if (!isJsonObject(value)) {
    throw new Error("Custom CLI output must be a JSON object.");
  }
  return {
    provider: providerId,
    text: readRequiredString(value.text, "text"),
    ...typeof value.summary === "string" ? { summary: value.summary } : {},
    ...isNonNegativeInteger(value.itemCount) ? { itemCount: value.itemCount } : {},
    ...isJsonObject(value.metadata) ? { metadata: value.metadata } : {}
  };
}
function readRequiredString(value, field) {
  if (typeof value !== "string") {
    throw new Error(`Custom CLI output field '${field}' must be a string.`);
  }
  return value;
}
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isJsonObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}
function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

// src/providers/exa.ts
import { Exa } from "exa-js";
var ExaProvider = class {
  id = "exa";
  label = "Exa";
  docsUrl = "https://exa.ai/docs/sdks/typescript-sdk-specification";
  capabilities = ["search", "contents", "answer", "research"];
  createTemplate() {
    return {
      enabled: false,
      apiKey: "EXA_API_KEY",
      native: {
        type: "auto",
        contents: {
          text: true
        }
      }
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.contents(request.urls, request.options, config, context)
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      case "research":
        return createBackgroundResearchPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: false,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true
            },
            researchLifecycle: {
              supportsStartRetries: false,
              supportsRequestTimeouts: false
            }
          },
          start: (context) => this.startResearch(request.input, request.options, config, context),
          poll: (id, context) => this.pollResearch(id, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, searchOptions, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }
    const client = new Exa(apiKey, config.baseUrl);
    const native = config.native ?? config.defaults;
    const options = {
      ...stripLocalExecutionOptions(asJsonObject(native)) ?? {},
      ...searchOptions ?? {},
      numResults: maxResults
    };
    context.onProgress?.(`Searching Exa for: ${query2}`);
    const response = await client.search(query2, options);
    return {
      provider: this.id,
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
        title: String(result.title ?? result.url ?? "Untitled"),
        url: String(result.url ?? ""),
        snippet: trimSnippet(
          typeof result.text === "string" ? result.text : Array.isArray(result.highlights) ? result.highlights.join(" ") : typeof result.summary === "string" ? result.summary : ""
        ),
        score: typeof result.score === "number" ? result.score : void 0
      }))
    };
  }
  async contents(urls, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }
    const client = new Exa(apiKey, config.baseUrl);
    context.onProgress?.(
      `Fetching contents from Exa for ${urls.length} URL(s)`
    );
    const response = await client.getContents(urls, options);
    const results = response.results ?? [];
    const lines = [];
    const contentsEntries = results.flatMap(
      (result, index) => {
        const title = String(result.title ?? result.url ?? "Untitled");
        const url = String(result.url ?? "");
        const entryLines = [`${index + 1}. ${title}`, `   ${url}`];
        const summary = typeof result.summary === "string" ? result.summary : result.summary ? formatJson(result.summary) : void 0;
        const fullText = typeof result.text === "string" ? result.text : summary ? summary : Array.isArray(result.highlights) ? result.highlights.join("\n\n") : "";
        const body = normalizeContentText(fullText);
        pushIndentedBlock(entryLines, body);
        lines.push(...entryLines, "");
        if (!url) {
          return [];
        }
        return [
          {
            url,
            title,
            body,
            summary: "1 content result via Exa",
            status: "ready"
          }
        ];
      }
    );
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${results.length} content result(s) via Exa`,
      itemCount: results.length,
      metadata: {
        contentsEntries
      }
    };
  }
  async answer(query2, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }
    const client = new Exa(apiKey, config.baseUrl);
    context.onProgress?.(`Getting Exa answer for: ${query2}`);
    const response = await client.answer(query2, options);
    const lines = [];
    lines.push(
      typeof response.answer === "string" ? response.answer : formatJson(response.answer)
    );
    const citations = response.citations ?? [];
    if (citations.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, citation] of citations.entries()) {
        lines.push(
          `${index + 1}. ${String(citation.title ?? citation.url ?? "Untitled")}`
        );
        lines.push(`   ${String(citation.url ?? "")}`);
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Exa with ${citations.length} source(s)`,
      itemCount: citations.length
    };
  }
  async startResearch(input, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }
    const client = new Exa(apiKey, config.baseUrl);
    const task = await client.research.create({
      instructions: input,
      ...options ?? {}
    });
    return { id: task.researchId };
  }
  async pollResearch(id, _options, config, _context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }
    const client = new Exa(apiKey, config.baseUrl);
    const result = await client.research.get(id, { events: false });
    if (result.status === "completed") {
      const content = result.output?.content;
      return {
        status: "completed",
        output: {
          provider: this.id,
          text: typeof content === "string" ? content : content !== void 0 ? formatJson(content) : "Exa research completed without textual output.",
          summary: "Research via Exa"
        }
      };
    }
    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error ?? "Exa research failed."
      };
    }
    if (result.status === "canceled") {
      return {
        status: "cancelled",
        error: "Exa research was canceled."
      };
    }
    return { status: "in_progress" };
  }
};

// src/providers/gemini.ts
import { GoogleGenAI } from "@google/genai";
var DEFAULT_SEARCH_MODEL = "gemini-2.5-flash";
var DEFAULT_CONTENTS_MODEL = "gemini-2.5-flash";
var DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
var DEFAULT_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";
var GeminiProvider = class {
  id = "gemini";
  label = "Gemini";
  docsUrl = "https://github.com/googleapis/js-genai";
  capabilities = ["search", "answer", "research"];
  createTemplate() {
    return {
      enabled: false,
      apiKey: "GOOGLE_API_KEY",
      native: {
        searchModel: DEFAULT_SEARCH_MODEL,
        answerModel: DEFAULT_ANSWER_MODEL,
        researchAgent: DEFAULT_RESEARCH_AGENT
      },
      policy: {
        researchMaxConsecutivePollErrors: DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS
      }
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    const planConfig = {
      policy: getGeminiExecutionPolicyDefaults(config)
    };
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "contents":
        return createSilentForegroundPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.contents(request.urls, request.options, config, context)
        });
      case "answer":
        return createSilentForegroundPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      case "research":
        return createBackgroundResearchPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true
            },
            researchLifecycle: {
              supportsStartRetries: true,
              supportsRequestTimeouts: true
            }
          },
          start: (context) => this.startResearch(request.input, request.options, config, context),
          poll: (id, context) => this.pollResearch(id, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, options, config, context) {
    const ai = this.createClient(config);
    const native = getGeminiNativeConfig(config);
    const request = buildGeminiSearchRequest(
      query2,
      native?.searchModel ?? DEFAULT_SEARCH_MODEL,
      options
    );
    context.onProgress?.(`Searching Gemini for: ${query2}`);
    const interaction = await createSearchInteraction(
      ai,
      request,
      context.signal
    );
    const results = await Promise.all(
      extractGoogleSearchResults(interaction.outputs).slice(0, maxResults).map(async (result) => {
        const resolvedUrl = await resolveGoogleSearchUrl(
          result.url,
          context.signal
        );
        return {
          title: result.title ?? resolvedUrl ?? result.url ?? "Untitled",
          url: resolvedUrl ?? result.url ?? "",
          snippet: ""
        };
      })
    );
    return {
      provider: this.id,
      results
    };
  }
  async contents(urls, options, config, context) {
    const ai = this.createClient(config);
    context.onProgress?.(
      `Fetching contents from Gemini for ${urls.length} URL(s)`
    );
    const urlList = urls.map((url) => `- ${url}`).join("\n");
    const defaultModel = DEFAULT_CONTENTS_MODEL;
    const structuredPrompt = `Extract the main textual content from each of the following URLs. For every successfully retrieved URL, return exactly one block in this format:
[[[URL]]]
<resolved URL>
[[[TITLE]]]
<title>
[[[BODY]]]
<cleaned body text>
[[[END]]]

Only include successfully retrieved URLs. Preserve headings, paragraphs, and lists in BODY, but remove navigation, ads, and boilerplate. Do not add any text outside these blocks.

${urlList}`;
    const structuredResponse = await requestGeminiContentsExtraction({
      ai,
      defaultModel,
      prompt: structuredPrompt,
      options,
      signal: context.signal
    });
    let text = structuredResponse.text;
    let metadata = structuredResponse.metadata;
    let contentsEntries = buildGeminiContentsEntries(text, urls, metadata);
    const hasReadyEntries = contentsEntries.some(
      (entry) => entry.status !== "failed"
    );
    if (shouldFallbackToLegacyGeminiContentsPrompt(
      text,
      metadata,
      hasReadyEntries
    )) {
      const fallbackResponse = await requestGeminiContentsExtraction({
        ai,
        defaultModel,
        prompt: `Extract the main textual content from each of the following URLs. For each URL, return the page title followed by the cleaned body text. Preserve the original structure (headings, paragraphs, lists) but remove navigation, ads, and boilerplate.

${urlList}`,
        options,
        signal: context.signal
      });
      text = fallbackResponse.text;
      metadata = fallbackResponse.metadata;
      contentsEntries = buildGeminiContentsEntries(text, urls, metadata);
    }
    if (shouldRetryEmptyGeminiContentsResponse(text, metadata)) {
      throw new Error(
        "Gemini returned an empty URL Context response. Retrying may succeed."
      );
    }
    const lines = [];
    const successfulEntries = contentsEntries.filter(
      (entry) => entry.status !== "failed"
    );
    if (successfulEntries.length > 0) {
      lines.push(renderGeminiContentsEntries(successfulEntries));
    } else if (text) {
      lines.push(text);
    }
    const retrievalFailures = metadata.filter(
      (entry) => entry.status !== "URL_RETRIEVAL_STATUS_SUCCESS" && entry.status !== void 0
    );
    if (retrievalFailures.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("Retrieval issues:");
      for (const failure of retrievalFailures) {
        lines.push(`- ${failure.url}: ${failure.status}`);
      }
    }
    const contentFailures = getGeminiContentFailures(
      contentsEntries,
      retrievalFailures
    );
    if (contentFailures.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("Content issues:");
      for (const failure of contentFailures) {
        lines.push(`- ${failure.url}: ${failure.body}`);
      }
    }
    const successCount = successfulEntries.length;
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents extracted.",
      summary: `${successCount} of ${urls.length} URL(s) extracted via Gemini`,
      itemCount: successCount,
      metadata: {
        contentsEntries
      }
    };
  }
  async answer(query2, options, config, context) {
    const ai = this.createClient(config);
    const native = getGeminiNativeConfig(config);
    const request = buildGeminiGenerateContentRequest({
      defaultModel: native?.answerModel ?? DEFAULT_ANSWER_MODEL,
      prompt: query2,
      options,
      toolConfig: { googleSearch: {} }
    });
    context.onProgress?.(`Getting Gemini answer for: ${query2}`);
    const response = await ai.models.generateContent({
      model: request.model,
      contents: request.contents,
      config: addAbortSignalToGeminiConfig(request.config, context.signal)
    });
    const lines = [];
    lines.push(response.text?.trim() || "No answer returned.");
    const sources = extractGroundingSources(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
    );
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        if (source.url) {
          lines.push(`   ${source.url}`);
        }
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Gemini with ${sources.length} source(s)`,
      itemCount: sources.length
    };
  }
  async startResearch(input, options, config, context) {
    const ai = this.createClient(config);
    const requestOptions = getGeminiResearchRequestOptions(options);
    const interaction = await ai.interactions.create(
      {
        ...requestOptions,
        input,
        agent: getGeminiNativeConfig(config)?.researchAgent ?? DEFAULT_RESEARCH_AGENT,
        background: true
      },
      buildGeminiRequestOptions(context.signal, context.idempotencyKey)
    );
    return { id: interaction.id };
  }
  async pollResearch(id, _options, config, context) {
    const ai = this.createClient(config);
    const interaction = await runWithoutGeminiInteractionsWarning(
      () => ai.interactions.get(
        id,
        void 0,
        buildGeminiRequestOptions(context.signal)
      )
    );
    if (interaction.status === "completed") {
      const text = formatInteractionOutputs(interaction.outputs);
      return {
        status: "completed",
        output: {
          provider: this.id,
          text: text || "Gemini research completed without textual output.",
          summary: "Research via Gemini"
        }
      };
    }
    if (interaction.status === "failed") {
      return {
        status: "failed",
        error: "Gemini research failed."
      };
    }
    if (interaction.status === "cancelled") {
      return {
        status: "cancelled",
        error: "Gemini research cancelled."
      };
    }
    return { status: "in_progress" };
  }
  createClient(config) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Gemini is missing an API key.");
    }
    return new GoogleGenAI({
      apiKey,
      apiVersion: getGeminiNativeConfig(config)?.apiVersion
    });
  }
};
function buildGeminiRequestOptions(signal, idempotencyKey) {
  if (!signal && !idempotencyKey) {
    return void 0;
  }
  return {
    ...signal ? { signal } : {},
    ...idempotencyKey ? { idempotencyKey } : {}
  };
}
function addAbortSignalToGeminiConfig(config, signal) {
  if (!signal) {
    return config;
  }
  return {
    ...config ?? {},
    abortSignal: signal
  };
}
function extractGoogleSearchResults(outputs) {
  const results = [];
  if (!Array.isArray(outputs)) {
    return results;
  }
  for (const output of outputs) {
    if (typeof output !== "object" || output === null) {
      continue;
    }
    const content = output;
    if (content.type !== "google_search_result") {
      continue;
    }
    const items = Array.isArray(content.result) ? content.result : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item;
      results.push({
        title: typeof record.title === "string" ? record.title : void 0,
        url: typeof record.url === "string" ? record.url : void 0,
        rendered_content: typeof record.rendered_content === "string" ? record.rendered_content : void 0
      });
    }
  }
  return results;
}
function extractGroundingSources(chunks) {
  const seen = /* @__PURE__ */ new Set();
  const sources = [];
  const maxSources = 5;
  if (!Array.isArray(chunks)) {
    return sources;
  }
  for (const chunk of chunks) {
    const web = typeof chunk === "object" && chunk !== null && "web" in chunk && typeof chunk.web === "object" && chunk.web !== null ? chunk.web : void 0;
    if (!web) continue;
    const rawUrl = typeof web.uri === "string" ? web.uri : "";
    const title = formatGroundingSourceTitle(
      typeof web.title === "string" ? web.title : rawUrl,
      rawUrl
    );
    const url = formatGroundingSourceUrl(rawUrl);
    const key = [title.toLowerCase(), url.toLowerCase()].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      title,
      url
    });
    if (sources.length >= maxSources) {
      break;
    }
  }
  return sources;
}
function extractUrlContextMetadata(candidates) {
  const results = [];
  if (!Array.isArray(candidates)) {
    return results;
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const metadata = candidate.urlContextMetadata;
    if (!metadata?.urlMetadata || !Array.isArray(metadata.urlMetadata)) {
      continue;
    }
    for (const entry of metadata.urlMetadata) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      results.push({
        url: typeof entry.retrievedUrl === "string" ? entry.retrievedUrl : "unknown",
        status: typeof entry.urlRetrievalStatus === "string" ? entry.urlRetrievalStatus : void 0
      });
    }
  }
  return results;
}
async function requestGeminiContentsExtraction({
  ai,
  defaultModel,
  prompt,
  options,
  signal
}) {
  const request = buildGeminiGenerateContentRequest({
    defaultModel,
    prompt,
    options,
    toolConfig: { urlContext: {} }
  });
  const response = await ai.models.generateContent({
    model: request.model,
    contents: [request.contents],
    config: addAbortSignalToGeminiConfig(request.config, signal)
  });
  return {
    text: response.text?.trim() || "",
    metadata: extractUrlContextMetadata(response.candidates)
  };
}
function shouldFallbackToLegacyGeminiContentsPrompt(text, metadata, hasReadyEntries) {
  if (hasReadyEntries) {
    return false;
  }
  if (text.trim().length === 0) {
    return true;
  }
  return metadata.some(
    (entry) => entry.status === void 0 || entry.status === "URL_RETRIEVAL_STATUS_SUCCESS"
  );
}
function shouldRetryEmptyGeminiContentsResponse(text, metadata) {
  if (text.trim().length > 0) {
    return false;
  }
  if (metadata.length === 0) {
    return true;
  }
  return metadata.some(
    (entry) => entry.status === void 0 || entry.status === "URL_RETRIEVAL_STATUS_SUCCESS"
  );
}
function buildGeminiContentsEntries(text, urls, metadata) {
  const parsedEntries = parseGeminiContentsBlocks(text);
  const orderedReadyEntries = orderGeminiContentsEntries(parsedEntries, urls);
  const readyEntries = orderedReadyEntries.length > 0 ? orderedReadyEntries.map((entry) => ({
    ...entry,
    summary: "1 content result via Gemini",
    status: "ready"
  })) : buildFallbackGeminiContentsEntries(text, urls, metadata);
  const retrievalFailureEntries = metadata.flatMap(
    (entry) => entry.status !== void 0 && entry.status !== "URL_RETRIEVAL_STATUS_SUCCESS" && !hasGeminiContentsEntryForUrl(readyEntries, entry.url) ? [
      {
        url: entry.url,
        title: entry.url,
        body: entry.status,
        status: "failed"
      }
    ] : []
  );
  const formatFailureEntries = metadata.flatMap(
    (entry) => isGeminiMetadataSuccess(entry) && !hasGeminiContentsEntryForUrl(readyEntries, entry.url) ? [
      {
        url: entry.url,
        title: entry.url,
        body: "Gemini returned content for this URL in an unexpected format.",
        status: "failed"
      }
    ] : []
  );
  return [...readyEntries, ...retrievalFailureEntries, ...formatFailureEntries];
}
function parseGeminiContentsBlocks(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const blocks = [];
  const pattern = /\[\[\[URL\]\]\]\s*\n([^\n]+)\n\[\[\[TITLE\]\]\]\s*\n([^\n]*)\n\[\[\[BODY\]\]\]\s*\n([\s\S]*?)\n\[\[\[END\]\]\]/g;
  for (const match of normalized.matchAll(pattern)) {
    const url = match[1]?.trim();
    const title = match[2]?.trim();
    const body = match[3]?.trim();
    if (!url || !body) {
      continue;
    }
    blocks.push({
      url,
      ...title ? { title } : {},
      body
    });
  }
  return blocks;
}
function orderGeminiContentsEntries(entries, urls) {
  if (entries.length <= 1) {
    return entries;
  }
  const entriesByUrl = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = normalizeGeminiUrl(entry.url);
    const bucket = entriesByUrl.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      entriesByUrl.set(key, [entry]);
    }
  }
  const ordered = [];
  for (const url of urls) {
    const key = normalizeGeminiUrl(url);
    const bucket = entriesByUrl.get(key);
    const next = bucket?.shift();
    if (next) {
      ordered.push(next);
    }
    if (bucket && bucket.length === 0) {
      entriesByUrl.delete(key);
    }
  }
  for (const bucket of entriesByUrl.values()) {
    ordered.push(...bucket);
  }
  return ordered;
}
function buildFallbackGeminiContentsEntries(text, urls, metadata) {
  if (!text) {
    return [];
  }
  const successfulMetadata = metadata.filter(
    (entry) => entry.status === "URL_RETRIEVAL_STATUS_SUCCESS" || entry.status === void 0
  );
  const fallbackUrl = successfulMetadata.length === 1 ? successfulMetadata[0]?.url : urls.length === 1 && metadata.length === 0 ? urls[0] : void 0;
  if (!fallbackUrl) {
    return [];
  }
  return [
    {
      url: fallbackUrl,
      title: extractGeminiContentsTitle(text),
      body: text,
      summary: "1 content result via Gemini",
      status: "ready"
    }
  ];
}
function extractGeminiContentsTitle(text) {
  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) {
    return void 0;
  }
  return firstLine.replace(/^#+\s*/, "").trim() || void 0;
}
function isGeminiMetadataSuccess(entry) {
  return entry.status === "URL_RETRIEVAL_STATUS_SUCCESS" || entry.status === void 0;
}
function getGeminiContentFailures(entries, retrievalFailures) {
  const retrievalFailureUrls = new Set(
    retrievalFailures.map((entry) => normalizeGeminiUrl(entry.url))
  );
  return entries.filter(
    (entry) => entry.status === "failed" && !retrievalFailureUrls.has(normalizeGeminiUrl(entry.url))
  );
}
function hasGeminiContentsEntryForUrl(entries, url) {
  const normalized = normalizeGeminiUrl(url);
  return entries.some((entry) => normalizeGeminiUrl(entry.url) === normalized);
}
function normalizeGeminiUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
function renderGeminiContentsEntries(entries) {
  return entries.map((entry, index) => {
    const heading = entry.title ?? entry.url;
    const lines = [`${index + 1}. ${heading}`];
    if (entry.url && entry.url !== heading) {
      lines.push(`   ${entry.url}`);
    }
    for (const line of entry.body.trim().split("\n")) {
      lines.push(`   ${line}`);
    }
    return lines.join("\n");
  }).join("\n\n").trim();
}
function formatInteractionOutputs(outputs) {
  const lines = [];
  if (!Array.isArray(outputs)) {
    return "";
  }
  for (const output of outputs) {
    if (typeof output === "object" && output !== null && "type" in output && output.type === "text" && "text" in output && typeof output.text === "string") {
      const text = output.text.trim();
      if (text) {
        lines.push(text);
      }
    }
  }
  return lines.join("\n\n").trim();
}
function formatGroundingSourceTitle(title, url) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
  return "Untitled";
}
function formatGroundingSourceUrl(url) {
  if (!url) {
    return "";
  }
  if (isGoogleGroundingRedirect(url)) {
    return "";
  }
  return url;
}
function isGoogleGroundingRedirect(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "vertexaisearch.cloud.google.com" && parsed.pathname.startsWith("/grounding-api-redirect/");
  } catch {
    return false;
  }
}
async function createSearchInteraction(ai, request, signal) {
  const forcedRequest = {
    ...request,
    ...request.generation_config ? {
      generation_config: {
        ...request.generation_config,
        tool_choice: "any"
      }
    } : {
      generation_config: {
        tool_choice: "any"
      }
    }
  };
  try {
    return await runWithoutGeminiInteractionsWarning(
      () => ai.interactions.create(forcedRequest, buildGeminiRequestOptions(signal))
    );
  } catch (error) {
    if (!isBuiltInToolChoiceError(error)) {
      throw error;
    }
    const fallbackGenerationConfig = stripToolChoice(request.generation_config);
    return runWithoutGeminiInteractionsWarning(
      () => ai.interactions.create(
        {
          ...request,
          ...fallbackGenerationConfig ? { generation_config: fallbackGenerationConfig } : {}
        },
        buildGeminiRequestOptions(signal)
      )
    );
  }
}
var GEMINI_INTERACTIONS_WARNING = /GoogleGenAI\.interactions: Interactions usage is experimental and may change in future versions\.?/;
var geminiWarningSuppressionDepth = 0;
var originalGeminiConsoleWarn;
var originalGeminiStderrWrite;
async function runWithoutGeminiInteractionsWarning(operation) {
  installGeminiWarningSuppression();
  try {
    return await operation();
  } finally {
    uninstallGeminiWarningSuppression();
  }
}
function installGeminiWarningSuppression() {
  geminiWarningSuppressionDepth += 1;
  if (geminiWarningSuppressionDepth !== 1) {
    return;
  }
  originalGeminiConsoleWarn = console.warn.bind(console);
  console.warn = (...args) => {
    if (matchesGeminiInteractionsWarning(args)) {
      return;
    }
    originalGeminiConsoleWarn?.(...args);
  };
  originalGeminiStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk, ...args) => {
    if (matchesGeminiInteractionsWarning([chunk])) {
      const callback = args.find(
        (arg) => typeof arg === "function"
      );
      callback?.(null);
      return true;
    }
    return originalGeminiStderrWrite?.(
      chunk,
      ...args
    ) ?? true;
  });
}
function uninstallGeminiWarningSuppression() {
  geminiWarningSuppressionDepth = Math.max(
    0,
    geminiWarningSuppressionDepth - 1
  );
  if (geminiWarningSuppressionDepth !== 0) {
    return;
  }
  if (originalGeminiConsoleWarn) {
    console.warn = originalGeminiConsoleWarn;
    originalGeminiConsoleWarn = void 0;
  }
  if (originalGeminiStderrWrite) {
    process.stderr.write = originalGeminiStderrWrite;
    originalGeminiStderrWrite = void 0;
  }
}
function matchesGeminiInteractionsWarning(parts) {
  const text = parts.map((part) => {
    if (typeof part === "string") {
      return part;
    }
    if (part instanceof Uint8Array) {
      return Buffer.from(part).toString("utf8");
    }
    return "";
  }).join(" ");
  return GEMINI_INTERACTIONS_WARNING.test(text);
}
function isBuiltInToolChoiceError(error) {
  if (error instanceof Error) {
    return error.message.includes(
      "Function calling config is set without function_declarations"
    );
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message.includes(
      "Function calling config is set without function_declarations"
    );
  }
  return false;
}
async function resolveGoogleSearchUrl(url, signal) {
  if (!url) {
    return void 0;
  }
  if (!isGoogleGroundingRedirect(url)) {
    return url;
  }
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal
    });
    return response.headers.get("location") || url;
  } catch {
    return url;
  }
}
function buildGeminiSearchRequest(query2, defaultModel, options) {
  return {
    model: readNonEmptyString3(options?.model) ?? defaultModel,
    input: query2,
    tools: [{ type: "google_search" }],
    ...isPlainObject3(options?.generation_config) ? { generation_config: options.generation_config } : {}
  };
}
function buildGeminiGenerateContentRequest({
  defaultModel,
  prompt,
  options,
  toolConfig
}) {
  const requestOptions = isPlainObject3(options) ? options : {};
  const explicitConfig = isPlainObject3(requestOptions.config) ? requestOptions.config : {};
  return {
    model: readNonEmptyString3(requestOptions.model) ?? defaultModel,
    contents: prompt,
    config: {
      ...explicitConfig,
      tools: [toolConfig]
    }
  };
}
function getGeminiResearchRequestOptions(options) {
  if (!isPlainObject3(options)) {
    return {};
  }
  return { ...options };
}
function stripToolChoice(generationConfig) {
  if (!generationConfig || !Object.hasOwn(generationConfig, "tool_choice")) {
    return generationConfig;
  }
  const { tool_choice: _ignored, ...rest } = generationConfig;
  return Object.keys(rest).length > 0 ? rest : void 0;
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getGeminiNativeConfig(config) {
  return config.native ?? config.defaults;
}
function getGeminiExecutionPolicyDefaults(config) {
  if (config.policy) {
    return config.policy;
  }
  return {
    requestTimeoutMs: config.defaults?.requestTimeoutMs,
    retryCount: config.defaults?.retryCount,
    retryDelayMs: config.defaults?.retryDelayMs,
    researchPollIntervalMs: config.defaults?.researchPollIntervalMs,
    researchTimeoutMs: config.defaults?.researchTimeoutMs,
    researchMaxConsecutivePollErrors: config.defaults?.researchMaxConsecutivePollErrors
  };
}
function readNonEmptyString3(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}

// src/providers/parallel.ts
import Parallel from "parallel-web";
var ParallelProvider = class {
  id = "parallel";
  label = "Parallel";
  docsUrl = "https://github.com/parallel-web/parallel-sdk-typescript";
  capabilities = ["search", "contents"];
  createTemplate() {
    return {
      enabled: false,
      apiKey: "PARALLEL_API_KEY",
      native: {
        search: {
          mode: "agentic"
        },
        extract: {
          excerpts: false,
          full_content: true
        }
      }
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.contents(request.urls, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, options, config, context) {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults = stripLocalExecutionOptions(asJsonObject(native?.search)) ?? {};
    context.onProgress?.(`Searching Parallel for: ${query2}`);
    const response = await client.beta.search(
      {
        ...defaults,
        ...options ?? {},
        objective: query2,
        max_results: maxResults
      },
      buildRequestOptions(context)
    );
    return {
      provider: this.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: trimSnippet(result.excerpts?.join(" ") ?? "")
      }))
    };
  }
  async contents(urls, options, config, context) {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults = stripLocalExecutionOptions(asJsonObject(native?.extract)) ?? {};
    context.onProgress?.(
      `Fetching contents from Parallel for ${urls.length} URL(s)`
    );
    const response = await client.beta.extract(
      {
        ...defaults,
        ...options ?? {},
        urls
      },
      buildRequestOptions(context)
    );
    const lines = [];
    const contentsEntries = response.results.map((result, index) => {
      const title = result.title ?? result.url;
      const entryLines = [`${index + 1}. ${title}`, `   ${result.url}`];
      const text = result.full_content ?? result.excerpts?.join("\n\n") ?? "";
      const body = normalizeContentText(text);
      pushIndentedBlock(entryLines, body);
      lines.push(...entryLines, "");
      return {
        url: result.url,
        title,
        body,
        summary: "1 content result via Parallel",
        status: "ready"
      };
    });
    for (const error of response.errors) {
      const detailLines = [error.error_type];
      if (error.content) {
        detailLines.push(trimSnippet(error.content));
      }
      lines.push(`Error: ${error.url}`);
      for (const line of detailLines) {
        lines.push(`   ${line}`);
      }
      lines.push("");
      contentsEntries.push({
        url: error.url,
        title: error.url,
        body: detailLines.join("\n"),
        status: "failed"
      });
    }
    const itemCount = response.results.length;
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${itemCount} content result(s) via Parallel`,
      itemCount,
      metadata: {
        contentsEntries
      }
    };
  }
  createClient(config) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Parallel is missing an API key.");
    }
    return new Parallel({
      apiKey,
      baseURL: resolveConfigValue(config.baseUrl)
    });
  }
};
function buildRequestOptions(context) {
  return context.signal ? { signal: context.signal } : void 0;
}

// src/providers/perplexity.ts
import Perplexity from "@perplexity-ai/perplexity_ai";
var DEFAULT_ANSWER_MODEL2 = "sonar";
var DEFAULT_RESEARCH_MODEL = "sonar-deep-research";
var PerplexityProvider = class {
  id = "perplexity";
  label = "Perplexity";
  docsUrl = "https://docs.perplexity.ai/docs/sdk/overview.md";
  capabilities = ["search", "answer", "research"];
  createTemplate() {
    return {
      enabled: false,
      apiKey: "PERPLEXITY_API_KEY",
      native: {
        answer: {
          model: DEFAULT_ANSWER_MODEL2
        },
        research: {
          model: DEFAULT_RESEARCH_MODEL
        }
      }
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      case "research":
        return createStreamingForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: false,
              timeoutMs: false,
              maxConsecutivePollErrors: false,
              resumeId: false
            }
          },
          execute: (context) => this.research(request.input, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, options, config, context) {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const request = {
      ...stripLocalExecutionOptions(asJsonObject(native?.search)) ?? {},
      ...options ?? {},
      query: query2,
      max_results: maxResults
    };
    context.onProgress?.(`Searching Perplexity for: ${query2}`);
    const response = await client.search.create(
      request,
      buildRequestOptions2(context)
    );
    return {
      provider: this.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: trimSnippet(result.snippet),
        metadata: result.date || result.last_updated ? {
          ...result.date ? { date: result.date } : {},
          ...result.last_updated ? { last_updated: result.last_updated } : {}
        } : void 0
      }))
    };
  }
  async answer(query2, options, config, context) {
    context.onProgress?.(`Getting Perplexity answer for: ${query2}`);
    return this.runSilentForegroundChatTool(
      query2,
      options,
      config,
      context,
      DEFAULT_ANSWER_MODEL2,
      "Answer"
    );
  }
  async research(input, options, config, context) {
    context.onProgress?.("Starting Perplexity research");
    return this.runStreamingForegroundChatTool(
      input,
      options,
      config,
      context,
      DEFAULT_RESEARCH_MODEL,
      "Research"
    );
  }
  async runSilentForegroundChatTool(input, options, config, context, fallbackModel, label, isResearch = false) {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults = stripLocalExecutionOptions(
      isResearch ? asJsonObject(native?.research) : asJsonObject(native?.answer)
    ) ?? {};
    const request = {
      ...defaults,
      ...options ?? {},
      messages: [{ role: "user", content: input }],
      model: resolveModel((options ?? {}).model, defaults.model, fallbackModel) ?? fallbackModel,
      stream: false
    };
    const response = await client.chat.completions.create(
      request,
      buildRequestOptions2(context)
    );
    const content = extractMessageText(response.choices[0]?.message?.content);
    const sources = dedupeSources(extractSources(response));
    const lines = [];
    lines.push(content || `No ${label.toLowerCase()} returned.`);
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `${label} via Perplexity with ${sources.length} source(s)`,
      itemCount: sources.length
    };
  }
  // Perplexity deep research currently fits streaming foreground mode: pi can
  // surface incremental text while the request is active, but there is no
  // durable job id to resume later.
  async runStreamingForegroundChatTool(input, options, config, context, fallbackModel, label) {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults = stripLocalExecutionOptions(asJsonObject(native?.research)) ?? {};
    const request = {
      ...defaults,
      ...options ?? {},
      messages: [{ role: "user", content: input }],
      model: resolveModel((options ?? {}).model, defaults.model, fallbackModel) ?? fallbackModel,
      stream: true
    };
    const stream = await client.chat.completions.create(
      request,
      buildRequestOptions2(context)
    );
    let partialText = "";
    let lastChunk;
    const sources = [];
    for await (const chunk of stream) {
      lastChunk = chunk;
      const deltaText = extractDeltaText(chunk.choices[0]?.delta?.content);
      if (deltaText) {
        partialText = `${partialText}${deltaText}`;
        context.onProgress?.(partialText.trim());
      }
      sources.push(...extractSources(chunk));
    }
    const finalText = partialText.trim() || extractMessageText(lastChunk?.choices?.[0]?.message?.content) || `No ${label.toLowerCase()} returned.`;
    const dedupedSources = dedupeSources(sources);
    const lines = [finalText];
    if (dedupedSources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of dedupedSources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `${label} via Perplexity with ${dedupedSources.length} source(s)`,
      itemCount: dedupedSources.length
    };
  }
  createClient(config) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Perplexity is missing an API key.");
    }
    return new Perplexity({
      apiKey,
      baseURL: resolveConfigValue(config.baseUrl)
    });
  }
};
function resolveModel(optionModel, defaultModel, fallbackModel) {
  if (typeof optionModel === "string" && optionModel.trim().length > 0) {
    return optionModel;
  }
  if (typeof defaultModel === "string" && defaultModel.trim().length > 0) {
    return defaultModel;
  }
  return fallbackModel;
}
function extractMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.flatMap((chunk) => {
    if (typeof chunk === "object" && chunk !== null && "type" in chunk && chunk.type === "text" && "text" in chunk && typeof chunk.text === "string") {
      return [chunk.text.trim()];
    }
    return [];
  }).filter((text) => text.length > 0).join("\n\n").trim();
}
function extractDeltaText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.flatMap((chunk) => {
    if (typeof chunk === "object" && chunk !== null && "type" in chunk && chunk.type === "text" && "text" in chunk && typeof chunk.text === "string") {
      return [chunk.text];
    }
    return [];
  }).join("");
}
function dedupeSources(sources) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const source of sources) {
    const title = source.title.trim() || source.url.trim() || "Untitled";
    const url = source.url.trim();
    if (!url) continue;
    const key = `${title.toLowerCase()}::${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ title, url });
  }
  return unique;
}
function extractSources(response) {
  const searchResults = response.search_results?.flatMap((result) => {
    const url = result.url?.trim() ?? "";
    if (!url) {
      return [];
    }
    return [{ title: result.title?.trim() ?? url, url }];
  }) ?? [];
  if (searchResults.length > 0) {
    return searchResults;
  }
  return response.citations?.flatMap((citation) => {
    const url = citation?.trim() ?? "";
    return url ? [{ title: url, url }] : [];
  }) ?? [];
}
function buildRequestOptions2(context) {
  return context.signal ? { signal: context.signal } : void 0;
}

// src/providers/valyu.ts
import { Valyu } from "valyu-js";
var ValyuProvider = class {
  id = "valyu";
  label = "Valyu";
  docsUrl = "https://docs.valyu.ai/sdk/typescript-sdk";
  capabilities = ["search", "contents", "answer", "research"];
  createTemplate() {
    return {
      enabled: false,
      apiKey: "VALYU_API_KEY",
      native: {
        searchType: "all",
        responseLength: "short"
      }
    };
  }
  getStatus(config) {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }
  buildPlan(request, config) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.search(
            request.query,
            request.maxResults,
            request.options,
            config,
            context
          )
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.contents(request.urls, request.options, config, context)
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context) => this.answer(request.query, request.options, config, context)
        });
      case "research":
        return createBackgroundResearchPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: false,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true
            },
            researchLifecycle: {
              supportsStartRetries: false,
              supportsRequestTimeouts: false
            }
          },
          start: (context) => this.startResearch(request.input, request.options, config, context),
          poll: (id, context) => this.pollResearch(id, request.options, config, context)
        });
      default:
        return null;
    }
  }
  async search(query2, maxResults, searchOptions, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }
    const client = new Valyu(apiKey, config.baseUrl);
    const native = config.native ?? config.defaults;
    const options = {
      ...stripLocalExecutionOptions(asJsonObject(native)) ?? {},
      ...searchOptions ?? {},
      maxNumResults: maxResults
    };
    context.onProgress?.(`Searching Valyu for: ${query2}`);
    const response = await client.search(query2, options);
    if (!response.success) {
      throw new Error(response.error || "Valyu search failed.");
    }
    return {
      provider: this.id,
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: trimSnippet(
          result.description ?? (typeof result.content === "string" ? result.content : "")
        ),
        score: result.relevance_score
      }))
    };
  }
  async contents(urls, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }
    const client = new Valyu(apiKey, config.baseUrl);
    context.onProgress?.(
      `Fetching contents from Valyu for ${urls.length} URL(s)`
    );
    const response = await client.contents(urls, options);
    const finalResponse = "jobId" in response ? await client.waitForJob(response.jobId, {
      onProgress: (status) => context.onProgress?.(
        `Fetching contents from Valyu: ${status.urlsProcessed}/${status.urlsTotal} processed`
      )
    }) : response;
    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "Valyu contents failed.");
    }
    const results = finalResponse.results ?? [];
    const lines = [];
    const contentsEntries = results.flatMap((result, index) => {
      const entryLines = [`${index + 1}. ${result.url}`];
      if (result.status === "failed") {
        const body2 = normalizeContentText(`Failed: ${result.error}`);
        pushIndentedBlock(entryLines, body2);
        lines.push(...entryLines, "");
        return [
          {
            url: result.url,
            title: result.url,
            body: body2,
            status: "failed"
          }
        ];
      }
      const contentText = typeof result.content === "string" || typeof result.content === "number" ? String(result.content) : result.content ? formatJson(result.content) : typeof result.summary === "string" ? result.summary : result.summary ? formatJson(result.summary) : "";
      const body = normalizeContentText(contentText);
      if (result.title) {
        entryLines.push(`   ${result.title}`);
      }
      pushIndentedBlock(entryLines, body);
      lines.push(...entryLines, "");
      return [
        {
          url: result.url,
          title: result.title,
          body,
          summary: "1 content result via Valyu",
          status: "ready"
        }
      ];
    });
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${results.length} content result(s) via Valyu`,
      itemCount: results.length,
      metadata: {
        contentsEntries
      }
    };
  }
  async answer(query2, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }
    const client = new Valyu(apiKey, config.baseUrl);
    context.onProgress?.(`Getting Valyu answer for: ${query2}`);
    const response = await client.answer(query2, {
      ...options ?? {},
      streaming: false
    });
    if (!("success" in response) || !response.success) {
      throw new Error(
        "error" in response && typeof response.error === "string" ? response.error : "Valyu answer failed."
      );
    }
    const lines = [];
    const contents = typeof response.contents === "string" ? response.contents : formatJson(response.contents);
    lines.push(contents);
    const sources = response.search_results ?? [];
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, result] of sources.entries()) {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   ${result.url}`);
      }
    }
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Valyu with ${sources.length} source(s)`,
      itemCount: sources.length
    };
  }
  async startResearch(input, options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }
    const client = new Valyu(apiKey, config.baseUrl);
    const task = await client.deepresearch.create({
      input,
      ...options ?? {}
    });
    if (!task.success || !task.deepresearch_id) {
      throw new Error(task.error || "Valyu deep research creation failed.");
    }
    return { id: task.deepresearch_id };
  }
  async pollResearch(id, _options, config, context) {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }
    const client = new Valyu(apiKey, config.baseUrl);
    const result = await client.deepresearch.status(id);
    if (!result.success) {
      throw new Error(result.error || "Valyu deep research failed.");
    }
    const progress = result.progress;
    if (progress) {
      context.onProgress?.(
        `Researching via Valyu: step ${progress.current_step}/${progress.total_steps}`
      );
    }
    if (result.status === "completed") {
      const lines = [];
      lines.push(
        typeof result.output === "string" ? result.output : result.output ? formatJson(result.output) : "Valyu deep research completed without textual output."
      );
      const sources = result.sources ?? [];
      if (sources.length > 0) {
        lines.push("");
        lines.push("Sources:");
        for (const [index, source] of sources.entries()) {
          lines.push(`${index + 1}. ${source.title}`);
          lines.push(`   ${source.url}`);
        }
      }
      return {
        status: "completed",
        output: {
          provider: this.id,
          text: lines.join("\n").trimEnd(),
          summary: `Research via Valyu with ${sources.length} source(s)`,
          itemCount: sources.length
        }
      };
    }
    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error || "Valyu deep research failed."
      };
    }
    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        error: result.error || "Valyu deep research was canceled."
      };
    }
    return { status: "in_progress" };
  }
};

// src/providers/index.ts
var PROVIDERS = [
  new ClaudeProvider(),
  new CloudflareProvider(),
  new CodexProvider(),
  new CustomCliProvider(),
  new ExaProvider(),
  new GeminiProvider(),
  new PerplexityProvider(),
  new ParallelProvider(),
  new ValyuProvider()
];
var PROVIDER_MAP = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider])
);

// src/provider-resolution.ts
function supportsProviderCapability(provider, capability) {
  return provider.capabilities.includes(capability);
}
function resolveProviderChoice(config, cwd, explicit) {
  return resolveProviderForCapability(config, cwd, "search", explicit);
}
function getEffectiveProviderConfig(config, providerId) {
  const providerConfig = config.providers?.[providerId];
  if (!providerConfig) {
    return void 0;
  }
  const mergedPolicy = mergeExecutionPolicyDefaults(
    config.genericSettings,
    providerConfig.policy
  );
  if (!mergedPolicy) {
    return providerConfig;
  }
  return {
    ...providerConfig,
    policy: mergedPolicy
  };
}
function mergeExecutionPolicyDefaults(shared, provider) {
  const merged = {
    requestTimeoutMs: provider?.requestTimeoutMs ?? shared?.requestTimeoutMs,
    retryCount: provider?.retryCount ?? shared?.retryCount,
    retryDelayMs: provider?.retryDelayMs ?? shared?.retryDelayMs,
    researchPollIntervalMs: provider?.researchPollIntervalMs ?? shared?.researchPollIntervalMs,
    researchTimeoutMs: provider?.researchTimeoutMs ?? shared?.researchTimeoutMs,
    researchMaxConsecutivePollErrors: provider?.researchMaxConsecutivePollErrors ?? shared?.researchMaxConsecutivePollErrors
  };
  return Object.values(merged).some((value) => value !== void 0) ? merged : void 0;
}
function getMappedProviderIdForCapability(config, capability) {
  const providerId = getMappedProviderForCapability(config, capability);
  return providerId === null ? void 0 : providerId;
}
function resolveProviderForCapability(config, cwd, capability, explicit) {
  const providerId = explicit ?? getMappedProviderIdForCapability(config, capability);
  if (!providerId) {
    throw new Error(
      `No provider is configured for '${capability}'. Run /web-providers to configure tool mappings.`
    );
  }
  const provider = PROVIDER_MAP[providerId];
  if (!supportsProviderCapability(provider, capability)) {
    throw new Error(
      `Provider '${providerId}' does not support '${capability}'.`
    );
  }
  const providerConfig = getEffectiveProviderConfig(config, providerId);
  const status = provider.getStatus(providerConfig, cwd, capability);
  if (!status.available) {
    throw new Error(
      `Provider '${providerId}' is not available: ${status.summary}.`
    );
  }
  return provider;
}

// src/provider-runtime.ts
import { randomUUID } from "node:crypto";
async function executeOperationPlan(plan, options, context) {
  if (plan.deliveryMode !== "background-research") {
    const requestPolicy = resolveForegroundExecutionPolicy(plan, options);
    return await runWithExecutionPolicy(
      `${plan.providerLabel} ${plan.capability} request`,
      plan.execute,
      requestPolicy,
      context
    );
  }
  const researchPolicy = resolveBackgroundResearchExecutionPolicy(
    plan,
    options
  );
  const lifecycleTraits = plan.traits?.researchLifecycle;
  const supportsSafeStartRetries = lifecycleTraits?.supportsStartRetries === true;
  const supportsRequestTimeouts = lifecycleTraits?.supportsRequestTimeouts === true;
  return await executeResearchWithLifecycle({
    providerLabel: plan.providerLabel,
    providerId: plan.providerId,
    context,
    policy: researchPolicy,
    startRetryCount: supportsSafeStartRetries ? researchPolicy.retryCount : 0,
    startRetryNotice: !supportsSafeStartRetries && researchPolicy.retryCount > 0 ? `${plan.providerLabel} research start retries are disabled to avoid duplicate background jobs; configured retries apply after the job starts.` : void 0,
    startIdempotencyKey: supportsSafeStartRetries ? `pi-web-providers:${plan.providerId}:${randomUUID()}` : void 0,
    startRetryOnTimeout: supportsSafeStartRetries,
    startRequestTimeoutMs: supportsRequestTimeouts ? researchPolicy.requestTimeoutMs : void 0,
    pollRequestTimeoutMs: supportsRequestTimeouts ? researchPolicy.requestTimeoutMs : void 0,
    start: plan.start,
    poll: plan.poll
  });
}
function resolvePlanExecutionSupport(plan) {
  const explicit = plan.traits?.executionSupport ?? {};
  return {
    requestTimeoutMs: explicit.requestTimeoutMs ?? inferExecutionSupport(plan, "requestTimeoutMs"),
    retryCount: explicit.retryCount ?? inferExecutionSupport(plan, "retryCount"),
    retryDelayMs: explicit.retryDelayMs ?? inferExecutionSupport(plan, "retryDelayMs"),
    pollIntervalMs: explicit.pollIntervalMs ?? inferExecutionSupport(plan, "pollIntervalMs"),
    timeoutMs: explicit.timeoutMs ?? inferExecutionSupport(plan, "timeoutMs"),
    maxConsecutivePollErrors: explicit.maxConsecutivePollErrors ?? inferExecutionSupport(plan, "maxConsecutivePollErrors"),
    resumeId: explicit.resumeId ?? inferExecutionSupport(plan, "resumeId")
  };
}
function resolveForegroundExecutionPolicy(plan, options) {
  const localOptions = parseLocalExecutionOptions(options);
  const executionSupport = resolvePlanExecutionSupport(plan);
  const unsupportedControls = getUnsupportedExecutionControls(
    localOptions,
    executionSupport
  );
  if (options?.resumeInteractionId !== void 0) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead."
    );
  }
  if (unsupportedControls.length > 0) {
    if (plan.capability === "research") {
      throw new Error(
        `${plan.providerLabel} research runs in ${formatForegroundMode(plan.deliveryMode)} mode and does not support ${unsupportedControls.join(", ")}. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`
      );
    }
    throw new Error(
      `${plan.providerLabel} ${plan.capability} does not support ${unsupportedControls.join(", ")}. These controls only apply to web_research. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`
    );
  }
  return resolveRequestExecutionPolicy(
    options,
    filterPolicyDefaults(plan.traits?.policyDefaults, executionSupport)
  );
}
function resolveBackgroundResearchExecutionPolicy(plan, options) {
  const localOptions = parseLocalExecutionOptions(options);
  const executionSupport = resolvePlanExecutionSupport(plan);
  if (options?.resumeInteractionId !== void 0) {
    throw new Error(
      "resumeInteractionId is not supported. Use resumeId instead."
    );
  }
  const unsupportedControls = getUnsupportedExecutionControls(
    localOptions,
    executionSupport
  );
  if (unsupportedControls.length > 0) {
    throw new Error(
      `${plan.providerLabel} research does not support ${unsupportedControls.join(", ")}. Use ${formatSupportedControls(executionSupport, plan.capability)} instead.`
    );
  }
  return resolveResearchExecutionPolicy(
    options,
    filterPolicyDefaults(plan.traits?.policyDefaults, executionSupport)
  );
}
function inferExecutionSupport(plan, key) {
  switch (key) {
    case "requestTimeoutMs":
      if (plan.deliveryMode !== "background-research") {
        return true;
      }
      return plan.traits?.researchLifecycle?.supportsRequestTimeouts === true;
    case "retryCount":
    case "retryDelayMs":
      return true;
    case "pollIntervalMs":
    case "timeoutMs":
    case "maxConsecutivePollErrors":
    case "resumeId":
      return plan.capability === "research" && plan.deliveryMode === "background-research";
  }
}
function getUnsupportedExecutionControls(localOptions, executionSupport) {
  return EXECUTION_CONTROL_KEYS.filter((key) => {
    const value = localOptions[key];
    return value !== void 0 && executionSupport[key] !== true;
  });
}
function filterPolicyDefaults(defaults, executionSupport) {
  if (!defaults) {
    return void 0;
  }
  const filtered = {
    requestTimeoutMs: executionSupport.requestTimeoutMs ? defaults.requestTimeoutMs : void 0,
    retryCount: executionSupport.retryCount ? defaults.retryCount : void 0,
    retryDelayMs: executionSupport.retryDelayMs ? defaults.retryDelayMs : void 0,
    researchPollIntervalMs: executionSupport.pollIntervalMs ? defaults.researchPollIntervalMs : void 0,
    researchTimeoutMs: executionSupport.timeoutMs ? defaults.researchTimeoutMs : void 0,
    researchMaxConsecutivePollErrors: executionSupport.maxConsecutivePollErrors ? defaults.researchMaxConsecutivePollErrors : void 0
  };
  return Object.values(filtered).some((value) => value !== void 0) ? filtered : void 0;
}
function formatSupportedControls(executionSupport, capability) {
  const supportedControls = EXECUTION_CONTROL_KEYS.filter(
    (key) => executionSupport[key] === true
  ).filter((key) => capability === "research" || key !== "resumeId");
  return supportedControls.length > 0 ? supportedControls.join("/") : "no local execution controls";
}
function formatForegroundMode(deliveryMode) {
  return deliveryMode === "streaming-foreground" ? "streaming foreground" : "silent foreground";
}

// src/prefetch-manager.ts
var CONTENT_ENTRY_KIND = "web-contents";
var CONTENT_BATCH_ENTRY_KIND = "web-contents-batch";
var PREFETCH_JOB_KIND = "web-prefetch-job";
var CONTENT_CACHE_VERSION = 2;
var DEFAULT_CONTENT_TTL_MS = 30 * 60 * 1e3;
var DEFAULT_PREFETCH_MAX_URLS = 3;
var MAX_PREFETCH_URLS = 5;
var contentStore = new MemoryContentStore();
var inFlightContents = /* @__PURE__ */ new Map();
var inFlightBatchContents = /* @__PURE__ */ new Map();
var contentStoreGeneration = 0;
async function cleanupContentStore() {
  try {
    await contentStore.cleanup();
  } catch {
  }
}
async function putContentStoreEntry({
  entry,
  generation
}) {
  if (generation !== contentStoreGeneration) {
    return false;
  }
  await contentStore.put(entry);
  return true;
}
async function startContentsPrefetch({
  config,
  cwd,
  urls,
  options,
  onProgress
}) {
  const selectedUrls = selectPrefetchUrls(urls, options.maxUrls);
  if (selectedUrls.length === 0) {
    return void 0;
  }
  const provider = resolveContentsProvider(config, cwd, options.provider);
  if (!provider) {
    return void 0;
  }
  const ttlMs = clampTtlMs(options.ttlMs);
  const contentOptions = options.contentsOptions;
  const contentKeys = selectedUrls.map(
    (url) => buildContentsStoreKey(url, provider.id, contentOptions)
  );
  const prefetchId = randomUUID2();
  const createdAt = Date.now();
  const generation = contentStoreGeneration;
  await putContentStoreEntry({
    generation,
    entry: {
      key: buildPrefetchJobStoreKey(prefetchId),
      kind: PREFETCH_JOB_KIND,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ttlMs,
      value: {
        prefetchId,
        provider: provider.id,
        urls: selectedUrls,
        contentKeys,
        createdAt
      }
    }
  });
  const task = Promise.allSettled(
    selectedUrls.map(
      (url) => ensureContentsStored({
        url,
        providerId: provider.id,
        config,
        cwd,
        options: contentOptions,
        ttlMs,
        onProgress,
        generation
      })
    )
  ).then(async (results) => {
    const failedResults = results.filter(
      (result) => result.status === "rejected"
    );
    const failedUrlCount = failedResults.length;
    const error = failedResults.length === 0 ? void 0 : failedResults.length === 1 ? formatUnknownError(failedResults[0].reason) : `${failedResults.length} URL(s) failed during prefetch.`;
    await putContentStoreEntry({
      generation,
      entry: {
        key: buildPrefetchJobStoreKey(prefetchId),
        kind: PREFETCH_JOB_KIND,
        status: failedUrlCount === selectedUrls.length ? "failed" : "ready",
        createdAt,
        updatedAt: Date.now(),
        expiresAt: createdAt + ttlMs,
        value: {
          prefetchId,
          provider: provider.id,
          urls: selectedUrls,
          contentKeys,
          createdAt
        },
        ...error ? { error } : {},
        metadata: {
          totalUrlCount: selectedUrls.length,
          failedUrlCount
        }
      }
    });
  }).catch(async (error) => {
    await putContentStoreEntry({
      generation,
      entry: {
        key: buildPrefetchJobStoreKey(prefetchId),
        kind: PREFETCH_JOB_KIND,
        status: "failed",
        createdAt,
        updatedAt: Date.now(),
        expiresAt: createdAt + ttlMs,
        value: {
          prefetchId,
          provider: provider.id,
          urls: selectedUrls,
          contentKeys,
          createdAt
        },
        error: formatUnknownError(error),
        metadata: {
          totalUrlCount: selectedUrls.length,
          failedUrlCount: selectedUrls.length
        }
      }
    });
  });
  void task;
  return {
    prefetchId,
    provider: provider.id,
    urlCount: selectedUrls.length,
    queuedUrls: selectedUrls
  };
}
async function canResolveContentsFromStore({
  urls,
  providerId,
  options
}) {
  if (urls.length === 0) {
    return false;
  }
  if (await hasStoredBatchContents({ urls, providerId, options })) {
    return true;
  }
  const now = Date.now();
  for (const url of urls) {
    const key = buildContentsStoreKey(url, providerId, options);
    if (inFlightContents.has(key)) {
      return true;
    }
    const entry = await contentStore.get(key);
    if (entry?.status === "ready" && isStoredContentsValue(entry.value) && !isExpired(entry, now)) {
      return true;
    }
  }
  return false;
}
async function hasStoredBatchContents({
  urls,
  providerId,
  options
}) {
  const key = buildBatchContentsStoreKey(urls, providerId, options);
  if (inFlightBatchContents.has(key)) {
    return true;
  }
  const entry = await contentStore.get(key);
  return entry?.status === "ready" && isStoredBatchContentsValue(entry.value) && !isExpired(entry, Date.now());
}
async function resolveContentsFromStore({
  urls,
  providerId,
  config,
  cwd,
  options,
  signal,
  onProgress
}) {
  if (await canResolveContentsFromStore({ urls, providerId, options })) {
    if (await hasStoredBatchContents({ urls, providerId, options })) {
      const batch2 = await ensureBatchContentsStored({
        urls,
        providerId,
        config,
        cwd,
        options,
        signal,
        onProgress
      });
      return {
        output: {
          provider: batch2.value.provider,
          text: renderStoredContentItems(
            orderStoredContentItemsForRequest(batch2.value.items, urls)
          ),
          summary: batch2.value.summary ?? `${batch2.value.urls.length} URL(s) fetched via ${batch2.value.provider}`,
          itemCount: batch2.value.itemCount ?? batch2.value.urls.length
        },
        cachedCount: batch2.fromCache ? batch2.value.urls.length : 0
      };
    }
    const settled = await Promise.allSettled(
      urls.map(
        (url) => ensureContentsStored({
          url,
          providerId,
          config,
          cwd,
          options,
          signal,
          onProgress
        })
      )
    );
    const results = settled.filter(
      (result) => result.status === "fulfilled"
    ).map((result) => result.value);
    const failures = settled.map(
      (result, index) => result.status === "rejected" ? {
        url: urls[index] ?? "",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      } : void 0
    ).filter(
      (result) => Boolean(result)
    );
    if (results.length === 0 && failures.length > 0) {
      throw new Error(
        failures.length === 1 ? failures[0]?.error ?? "web_contents failed." : `web_contents failed for all ${failures.length} URL(s): ${failures.map(
          (failure, index) => `${index + 1}. ${failure.url} \u2014 ${failure.error}`
        ).join("; ")}`
      );
    }
    const cachedCount = results.filter((r) => r.fromCache).length;
    const provider = results[0]?.value.provider ?? providerId;
    const renderedItems = results.map((result) => result.value.item);
    const textBlocks = [renderStoredContentItems(renderedItems)].filter(
      Boolean
    );
    for (const failure of failures) {
      textBlocks.push(`Error: ${failure.url}
   ${failure.error}`);
    }
    return {
      output: {
        provider,
        text: textBlocks.join("\n\n").trim() || "No contents found.",
        summary: cachedCount > 0 ? `${results.length} of ${urls.length} URL(s) resolved via ${provider} (${cachedCount} cached)` : `${results.length} of ${urls.length} URL(s) fetched via ${provider}`,
        itemCount: results.length
      },
      cachedCount
    };
  }
  const batch = await ensureBatchContentsStored({
    urls,
    providerId,
    config,
    cwd,
    options,
    signal,
    onProgress
  });
  return {
    output: {
      provider: batch.value.provider,
      text: renderStoredContentItems(
        orderStoredContentItemsForRequest(batch.value.items, urls)
      ),
      summary: batch.value.summary ?? `${batch.value.urls.length} URL(s) fetched via ${batch.value.provider}`,
      itemCount: batch.value.itemCount ?? batch.value.urls.length
    },
    cachedCount: batch.fromCache ? batch.value.urls.length : 0
  };
}
function parseSearchContentsPrefetchOptions(options) {
  const raw = options?.prefetch;
  if (raw === void 0) {
    return void 0;
  }
  if (!isJsonObject2(raw)) {
    throw new Error("prefetch must be an object.");
  }
  const maxUrls = parseOptionalPositiveInteger(raw.maxUrls, "maxUrls");
  const provider = parseOptionalProviderId(raw.provider);
  const ttlMs = parseOptionalPositiveInteger(raw.ttlMs, "ttlMs");
  const contentsOptions = raw.contentsOptions === void 0 ? void 0 : assertJsonObject(raw.contentsOptions, "prefetch.contentsOptions");
  return {
    maxUrls,
    provider,
    ttlMs,
    contentsOptions
  };
}
function mergeSearchContentsPrefetchOptions(defaults, overrides) {
  if (!defaults && !overrides) {
    return void 0;
  }
  return {
    provider: overrides?.provider !== void 0 ? overrides.provider : defaults?.provider,
    maxUrls: overrides?.maxUrls !== void 0 ? overrides.maxUrls : defaults?.maxUrls,
    ttlMs: overrides?.ttlMs !== void 0 ? overrides.ttlMs : defaults?.ttlMs,
    contentsOptions: overrides?.contentsOptions !== void 0 ? overrides.contentsOptions : void 0
  };
}
function stripSearchContentsPrefetchOptions(options) {
  if (!options) {
    return void 0;
  }
  const { prefetch: _prefetch, ...rest } = options;
  return Object.keys(rest).length > 0 ? rest : void 0;
}
function resetContentStore() {
  contentStoreGeneration += 1;
  contentStore.clear();
  inFlightContents.clear();
  inFlightBatchContents.clear();
}
function deleteInFlightEntryIfCurrent(map, key, generation, task) {
  const current = map.get(key);
  if (current?.generation === generation && current.task === task) {
    map.delete(key);
  }
}
async function ensureBatchContentsStored({
  urls,
  providerId,
  config,
  cwd,
  options,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  signal,
  onProgress,
  generation = contentStoreGeneration
}) {
  const normalizedUrls = normalizeUrlSet(urls);
  if (normalizedUrls.length === 0) {
    throw new Error("At least one valid HTTP(S) URL is required.");
  }
  const key = buildBatchContentsStoreKey(normalizedUrls, providerId, options);
  const existingInFlight = inFlightBatchContents.get(key);
  if (existingInFlight) {
    return await existingInFlight.task;
  }
  let task;
  task = (async () => {
    const existing = await contentStore.get(key);
    const now = Date.now();
    if (existing?.status === "ready" && isStoredBatchContentsValue(existing.value) && !isExpired(existing, now)) {
      return { value: existing.value, fromCache: true };
    }
    const provider = PROVIDER_MAP[providerId];
    const providerConfig = getEffectiveProviderConfig(config, providerId);
    if (!providerConfig) {
      throw new Error(`Provider '${providerId}' is not configured.`);
    }
    const createdAt = now;
    await putContentStoreEntry({
      generation,
      entry: {
        key,
        kind: CONTENT_BATCH_ENTRY_KIND,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt + ttlMs,
        metadata: {
          urls: normalizedUrls,
          provider: providerId,
          optionsHash: hashOptions(options)
        }
      }
    });
    try {
      const plan = provider.buildPlan(
        {
          capability: "contents",
          urls: normalizedUrls,
          options: stripLocalExecutionOptions(options)
        },
        providerConfig
      );
      if (!plan) {
        throw new Error(
          `Provider '${providerId}' could not build a contents plan.`
        );
      }
      const result = await executeOperationPlan(plan, options, {
        cwd,
        signal,
        onProgress
      });
      if ("results" in result) {
        throw new Error(
          `${provider.label} contents returned an invalid result.`
        );
      }
      const fetchedAt = Date.now();
      const structuredEntries = extractStoredContentsEntriesFromMetadata(
        result.metadata
      );
      const stored = {
        urls: normalizedUrls,
        provider: result.provider,
        items: structuredEntries.length > 0 ? structuredEntries.map((entry) => toStoredContentItem(entry)) : [{ body: result.text }],
        summary: result.summary,
        itemCount: result.itemCount,
        fetchedAt
      };
      await putContentStoreEntry({
        generation,
        entry: {
          key,
          kind: CONTENT_BATCH_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: fetchedAt,
          expiresAt: fetchedAt + ttlMs,
          value: stored,
          metadata: {
            urls: normalizedUrls,
            provider: result.provider,
            optionsHash: hashOptions(options)
          }
        }
      });
      await storePerUrlContentsEntries({
        entries: structuredEntries,
        provider: result.provider,
        options,
        createdAt,
        fetchedAt,
        ttlMs,
        generation
      });
      return { value: stored, fromCache: false };
    } catch (error) {
      await putContentStoreEntry({
        generation,
        entry: {
          key,
          kind: CONTENT_BATCH_ENTRY_KIND,
          status: "failed",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            urls: normalizedUrls,
            provider: providerId,
            optionsHash: hashOptions(options)
          }
        }
      });
      throw error;
    } finally {
      deleteInFlightEntryIfCurrent(
        inFlightBatchContents,
        key,
        generation,
        task
      );
    }
  })();
  inFlightBatchContents.set(key, { generation, task });
  return await task;
}
async function ensureContentsStored({
  url,
  providerId,
  config,
  cwd,
  options,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  signal,
  onProgress,
  generation = contentStoreGeneration
}) {
  const key = buildContentsStoreKey(url, providerId, options);
  const existingInFlight = inFlightContents.get(key);
  if (existingInFlight) {
    return await existingInFlight.task;
  }
  let task;
  task = (async () => {
    const existing = await contentStore.get(key);
    const now = Date.now();
    if (existing?.status === "ready" && isStoredContentsValue(existing.value) && !isExpired(existing, now)) {
      return { value: existing.value, fromCache: true };
    }
    const provider = PROVIDER_MAP[providerId];
    const providerConfig = getEffectiveProviderConfig(config, providerId);
    if (!providerConfig) {
      throw new Error(`Provider '${providerId}' is not configured.`);
    }
    const createdAt = now;
    await putContentStoreEntry({
      generation,
      entry: {
        key,
        kind: CONTENT_ENTRY_KIND,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt + ttlMs,
        metadata: {
          url: canonicalizeUrl(url),
          provider: providerId,
          optionsHash: hashOptions(options)
        }
      }
    });
    try {
      const plan = provider.buildPlan(
        {
          capability: "contents",
          urls: [canonicalizeUrl(url)],
          options: stripLocalExecutionOptions(options)
        },
        providerConfig
      );
      if (!plan) {
        throw new Error(
          `Provider '${providerId}' could not build a contents plan.`
        );
      }
      const result = await executeOperationPlan(plan, options, {
        cwd,
        signal,
        onProgress
      });
      if ("results" in result) {
        throw new Error(
          `${provider.label} contents returned an invalid result.`
        );
      }
      const now2 = Date.now();
      const canonicalUrl = canonicalizeUrl(url);
      const structuredEntry = findStoredContentsEntry(
        extractStoredContentsEntriesFromMetadata(result.metadata),
        canonicalUrl
      );
      const stored = {
        url: canonicalUrl,
        provider: result.provider,
        item: structuredEntry ? toStoredContentItem(structuredEntry) : { body: result.text },
        fetchedAt: now2
      };
      await putContentStoreEntry({
        generation,
        entry: {
          key,
          kind: CONTENT_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: now2,
          expiresAt: now2 + ttlMs,
          value: stored,
          metadata: {
            url: canonicalUrl,
            provider: result.provider,
            optionsHash: hashOptions(options)
          }
        }
      });
      return { value: stored, fromCache: false };
    } catch (error) {
      await putContentStoreEntry({
        generation,
        entry: {
          key,
          kind: CONTENT_ENTRY_KIND,
          status: "failed",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            url: canonicalizeUrl(url),
            provider: providerId,
            optionsHash: hashOptions(options)
          }
        }
      });
      throw error;
    } finally {
      deleteInFlightEntryIfCurrent(inFlightContents, key, generation, task);
    }
  })();
  inFlightContents.set(key, { generation, task });
  return await task;
}
async function storePerUrlContentsEntries({
  entries,
  provider,
  options,
  createdAt,
  fetchedAt,
  ttlMs,
  generation
}) {
  await Promise.all(
    entries.map(async (entry) => {
      const canonicalUrl = canonicalizeUrl(entry.url);
      if (entry.status === "failed" || !/^https?:\/\//i.test(canonicalUrl)) {
        return;
      }
      await putContentStoreEntry({
        generation,
        entry: {
          key: buildContentsStoreKey(canonicalUrl, provider, options),
          kind: CONTENT_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: fetchedAt,
          expiresAt: fetchedAt + ttlMs,
          value: {
            url: canonicalUrl,
            provider,
            item: toStoredContentItem(entry),
            fetchedAt
          },
          metadata: {
            url: canonicalUrl,
            provider,
            optionsHash: hashOptions(options)
          }
        }
      });
    })
  );
}
function extractStoredContentsEntriesFromMetadata(metadata) {
  const rawEntries = metadata?.contentsEntries;
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  return rawEntries.flatMap(
    (entry) => isStoredContentsMetadataEntry(entry) ? [entry] : []
  );
}
function isStoredContentsMetadataEntry(value) {
  return isJsonObject2(value) && typeof value.url === "string" && (value.title === void 0 || typeof value.title === "string") && typeof value.body === "string" && (value.summary === void 0 || typeof value.summary === "string") && (value.status === void 0 || value.status === "ready" || value.status === "failed");
}
function toStoredContentItem(entry) {
  return {
    url: entry.url,
    title: entry.title,
    body: entry.body,
    summary: entry.summary,
    status: entry.status
  };
}
function findStoredContentsEntry(entries, url) {
  return entries.find(
    (entry) => entry.status !== "failed" && canonicalizeUrl(entry.url) === url
  );
}
function buildBatchContentsStoreKey(urls, providerId, options) {
  return createStoreKey([
    CONTENT_BATCH_ENTRY_KIND,
    `v${CONTENT_CACHE_VERSION}`,
    providerId,
    hashKey(stableStringify(normalizeUrlSet(urls))),
    hashOptions(options)
  ]);
}
function buildContentsStoreKey(url, providerId, options) {
  return createStoreKey([
    CONTENT_ENTRY_KIND,
    `v${CONTENT_CACHE_VERSION}`,
    providerId,
    hashKey(canonicalizeUrl(url)),
    hashOptions(options)
  ]);
}
function buildPrefetchJobStoreKey(prefetchId) {
  return createStoreKey([PREFETCH_JOB_KIND, prefetchId]);
}
function resolveContentsProvider(config, cwd, explicitProvider) {
  if (!explicitProvider) {
    return void 0;
  }
  const provider = PROVIDER_MAP[explicitProvider];
  if (!provider.capabilities.includes("contents")) {
    return void 0;
  }
  const providerConfig = getEffectiveProviderConfig(config, explicitProvider);
  const status = provider.getStatus(providerConfig, cwd, "contents");
  if (status.available) {
    return provider;
  }
  return void 0;
}
function canonicalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
function normalizeUrlSet(urls) {
  return [...new Set(urls.map((url) => canonicalizeUrl(url)).filter(Boolean))].filter((url) => /^https?:\/\//i.test(url)).sort();
}
function selectPrefetchUrls(urls, maxUrls) {
  const selected = [];
  const seen = /* @__PURE__ */ new Set();
  const limit = clampPrefetchUrlCount(maxUrls);
  for (const url of urls) {
    const canonical = canonicalizeUrl(url);
    if (!/^https?:\/\//i.test(canonical) || seen.has(canonical)) {
      continue;
    }
    selected.push(canonical);
    seen.add(canonical);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}
function clampPrefetchUrlCount(value) {
  if (value === void 0) {
    return DEFAULT_PREFETCH_MAX_URLS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PREFETCH_URLS);
}
function clampTtlMs(value) {
  if (value === void 0) {
    return DEFAULT_CONTENT_TTL_MS;
  }
  return Math.max(1e3, value);
}
function isExpired(entry, now) {
  return entry.expiresAt !== void 0 && entry.expiresAt <= now;
}
function formatUnknownError(error) {
  return error instanceof Error ? error.message : String(error);
}
function renderStoredContentItems(items) {
  if (items.length === 0) {
    return "No contents found.";
  }
  const blocks = items.map(
    (item, index) => renderStoredContentItem(item, index)
  );
  return blocks.join("\n\n").trim() || "No contents found.";
}
function orderStoredContentItemsForRequest(items, urls) {
  const itemsByUrl = /* @__PURE__ */ new Map();
  const extras = [];
  for (const item of items) {
    if (!item.url) {
      extras.push(item);
      continue;
    }
    const key = canonicalizeUrl(item.url);
    const bucket = itemsByUrl.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByUrl.set(key, [item]);
    }
  }
  if (itemsByUrl.size === 0) {
    return items;
  }
  const ordered = [];
  for (const url of urls) {
    const key = canonicalizeUrl(url);
    const bucket = itemsByUrl.get(key);
    const next = bucket?.shift();
    if (next) {
      ordered.push(next);
    }
    if (bucket && bucket.length === 0) {
      itemsByUrl.delete(key);
    }
  }
  for (const bucket of itemsByUrl.values()) {
    ordered.push(...bucket);
  }
  ordered.push(...extras);
  return ordered;
}
function renderStoredContentItem(item, index) {
  const hasStructuredHeader = Boolean(item.title || item.url);
  if (!hasStructuredHeader) {
    return item.body.trim();
  }
  const heading = item.status === "failed" ? `Error: ${item.url ?? item.title ?? "Untitled"}` : item.title ?? item.url ?? "Untitled";
  const lines = [
    `${index === void 0 ? "" : `${index + 1}. `}${heading}`.trim()
  ];
  if (item.status !== "failed" && item.url && item.url !== heading) {
    lines.push(`   ${item.url}`);
  }
  if (item.body.trim()) {
    for (const line of item.body.trim().split("\n")) {
      lines.push(`   ${line}`);
    }
  }
  return lines.join("\n").trimEnd();
}
function hashOptions(options) {
  return hashKey(stableStringify(stripLocalExecutionOptions(options) ?? {}));
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`
  ).join(",")}}`;
}
function isJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertJsonObject(value, field) {
  if (!isJsonObject2(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}
function parseOptionalPositiveInteger(value, field) {
  if (value === void 0) {
    return void 0;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`prefetch.${field} must be a positive integer.`);
  }
  return Number(value);
}
function parseOptionalProviderId(value) {
  if (value === void 0) {
    return void 0;
  }
  if (value === null) {
    return null;
  }
  if (isProviderId(value)) {
    return value;
  }
  throw new Error("prefetch.provider must be a valid provider id or null.");
}
function isProviderId(value) {
  return value === "claude" || value === "codex" || value === "exa" || value === "gemini" || value === "perplexity" || value === "parallel" || value === "valyu";
}
function isStoredBatchContentsValue(value) {
  if (!isJsonObject2(value)) {
    return false;
  }
  return Array.isArray(value.urls) && value.urls.every((item) => typeof item === "string") && isProviderId(value.provider) && Array.isArray(value.items) && value.items.every((item) => isStoredContentItem(item)) && typeof value.fetchedAt === "number";
}
function isStoredContentsValue(value) {
  if (!isJsonObject2(value)) {
    return false;
  }
  return typeof value.url === "string" && isProviderId(value.provider) && isStoredContentItem(value.item) && typeof value.fetchedAt === "number";
}
function isStoredContentItem(value) {
  return isJsonObject2(value) && (value.url === void 0 || typeof value.url === "string") && (value.title === void 0 || typeof value.title === "string") && typeof value.body === "string" && (value.summary === void 0 || typeof value.summary === "string") && (value.status === void 0 || value.status === "ready" || value.status === "failed");
}

// src/provider-config-manifests.ts
var PROVIDER_CONFIG_MANIFESTS = {
  claude: {
    settings: [
      stringSetting({
        id: "model",
        label: "Model",
        help: "Optional Claude model override. Leave empty to use the local default.",
        getValue: (config) => getClaudeNative(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(ensureClaudeNative(config), "model", value);
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "claudeEffort",
        label: "Effort",
        help: "How much effort Claude should use. 'default' uses the SDK default.",
        values: ["default", "low", "medium", "high", "max"],
        getValue: (config) => getClaudeNative(config)?.effort ?? "default",
        setValue: (config, value) => {
          const native = ensureClaudeNative(config);
          if (value === "default") {
            delete native.effort;
          } else {
            native.effort = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      integerSetting({
        id: "claudeMaxTurns",
        label: "Max turns",
        help: "Optional maximum number of Claude turns. Leave empty to use the SDK default.",
        minimum: 1,
        errorMessage: "Claude max turns must be a positive integer.",
        getValue: (config) => getIntegerString(getClaudeNative(config)?.maxTurns),
        setValue: (config, value) => {
          assignOptionalInteger(
            ensureClaudeNative(config),
            "maxTurns",
            value,
            "Claude max turns must be a positive integer."
          );
          cleanupEmpty(config, "native");
        }
      }),
      stringSetting({
        id: "claudePathToExecutable",
        label: "Executable path",
        help: "Optional path to the Claude Code executable. Leave empty to use the bundled/default executable.",
        getValue: (config) => config?.pathToClaudeCodeExecutable,
        setValue: (config, value) => {
          assignOptionalString(
            config,
            "pathToClaudeCodeExecutable",
            value
          );
        }
      })
    ]
  },
  codex: {
    settings: [
      stringSetting({
        id: "model",
        label: "Model",
        help: "Optional Codex model override. Leave empty to use the local default.",
        getValue: (config) => getCodexNative(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(
            ensureCodexNative(config),
            "model",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "modelReasoningEffort",
        label: "Reasoning effort",
        help: "Reasoning depth for Codex. 'default' uses the SDK default.",
        values: ["default", "minimal", "low", "medium", "high", "xhigh"],
        getValue: (config) => getCodexNative(config)?.modelReasoningEffort ?? "default",
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          if (value === "default") {
            delete native.modelReasoningEffort;
          } else {
            native.modelReasoningEffort = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "webSearchMode",
        label: "Web search mode",
        help: "How Codex should source web results. 'default' currently behaves like 'live'.",
        values: ["default", "disabled", "cached", "live"],
        getValue: (config) => getCodexNative(config)?.webSearchMode ?? "default",
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          if (value === "default") {
            delete native.webSearchMode;
          } else {
            native.webSearchMode = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "networkAccessEnabled",
        label: "Network access",
        help: "Allow Codex network access during search runs. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) => getBooleanValue(getCodexNative(config)?.networkAccessEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexNative(config),
            "networkAccessEnabled",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "webSearchEnabled",
        label: "Web search",
        help: "Enable Codex web search. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) => getBooleanValue(getCodexNative(config)?.webSearchEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexNative(config),
            "webSearchEnabled",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      stringSetting({
        id: "additionalDirectories",
        label: "Additional dirs",
        help: "Optional comma-separated directories that Codex may read in addition to the current working directory.",
        getValue: (config) => getCodexNative(config)?.additionalDirectories?.join(", "),
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          const trimmed = value.trim();
          if (!trimmed) {
            delete native.additionalDirectories;
          } else {
            native.additionalDirectories = trimmed.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          }
          cleanupEmpty(config, "native");
        }
      })
    ]
  },
  cloudflare: {
    settings: [
      stringSetting({
        id: "apiToken",
        label: "API token",
        help: "Cloudflare API token with Browser Rendering permissions. You can use a literal value, an env var name like CLOUDFLARE_API_TOKEN, or !command.",
        secret: true,
        getValue: (config) => config?.apiToken,
        setValue: (config, value) => {
          assignOptionalString(
            config,
            "apiToken",
            value
          );
        }
      }),
      stringSetting({
        id: "accountId",
        label: "Account ID",
        help: "Cloudflare account ID. You can use a literal value, an env var name like CLOUDFLARE_ACCOUNT_ID, or !command.",
        getValue: (config) => config?.accountId,
        setValue: (config, value) => {
          assignOptionalString(
            config,
            "accountId",
            value
          );
        }
      }),
      ...requestPolicySettings()
    ]
  },
  "custom-cli": {
    settings: [
      jsonArraySetting({
        id: "customCliSearchArgv",
        label: "Search argv",
        help: `Optional JSON string array for the command to run for web_search, for example ["node","./scripts/codex-search.mjs"].`,
        getValue: (config) => getCustomCliNative(config)?.search?.argv ? JSON.stringify(getCustomCliNative(config)?.search?.argv) : void 0,
        setValue: (config, value) => {
          setCustomCliArgv(config, "search", value);
        }
      }),
      stringSetting({
        id: "customCliSearchCwd",
        label: "Search cwd",
        help: "Optional working directory for the web_search command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomCliNative(config)?.search?.cwd,
        setValue: (config, value) => {
          setCustomCliCwd(config, "search", value);
        }
      }),
      stringSetting({
        id: "customCliSearchEnv",
        label: "Search env",
        help: "Optional JSON object of string environment variables for the web_search command. Values can be literal strings, env var names, or !command.",
        getValue: (config) => formatCustomCliEnv(getCustomCliNative(config)?.search?.env),
        setValue: (config, value) => {
          setCustomCliEnv(config, "search", value);
        }
      }),
      jsonArraySetting({
        id: "customCliContentsArgv",
        label: "Contents argv",
        help: "Optional JSON string array for the command to run for web_contents.",
        getValue: (config) => getCustomCliNative(config)?.contents?.argv ? JSON.stringify(getCustomCliNative(config)?.contents?.argv) : void 0,
        setValue: (config, value) => {
          setCustomCliArgv(config, "contents", value);
        }
      }),
      stringSetting({
        id: "customCliContentsCwd",
        label: "Contents cwd",
        help: "Optional working directory for the web_contents command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomCliNative(config)?.contents?.cwd,
        setValue: (config, value) => {
          setCustomCliCwd(config, "contents", value);
        }
      }),
      stringSetting({
        id: "customCliContentsEnv",
        label: "Contents env",
        help: "Optional JSON object of string environment variables for the web_contents command. Values can be literal strings, env var names, or !command.",
        getValue: (config) => formatCustomCliEnv(getCustomCliNative(config)?.contents?.env),
        setValue: (config, value) => {
          setCustomCliEnv(config, "contents", value);
        }
      }),
      jsonArraySetting({
        id: "customCliAnswerArgv",
        label: "Answer argv",
        help: "Optional JSON string array for the command to run for web_answer.",
        getValue: (config) => getCustomCliNative(config)?.answer?.argv ? JSON.stringify(getCustomCliNative(config)?.answer?.argv) : void 0,
        setValue: (config, value) => {
          setCustomCliArgv(config, "answer", value);
        }
      }),
      stringSetting({
        id: "customCliAnswerCwd",
        label: "Answer cwd",
        help: "Optional working directory for the web_answer command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomCliNative(config)?.answer?.cwd,
        setValue: (config, value) => {
          setCustomCliCwd(config, "answer", value);
        }
      }),
      stringSetting({
        id: "customCliAnswerEnv",
        label: "Answer env",
        help: "Optional JSON object of string environment variables for the web_answer command. Values can be literal strings, env var names, or !command.",
        getValue: (config) => formatCustomCliEnv(getCustomCliNative(config)?.answer?.env),
        setValue: (config, value) => {
          setCustomCliEnv(config, "answer", value);
        }
      }),
      jsonArraySetting({
        id: "customCliResearchArgv",
        label: "Research argv",
        help: "Optional JSON string array for the command to run for web_research.",
        getValue: (config) => getCustomCliNative(config)?.research?.argv ? JSON.stringify(getCustomCliNative(config)?.research?.argv) : void 0,
        setValue: (config, value) => {
          setCustomCliArgv(config, "research", value);
        }
      }),
      stringSetting({
        id: "customCliResearchCwd",
        label: "Research cwd",
        help: "Optional working directory for the web_research command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomCliNative(config)?.research?.cwd,
        setValue: (config, value) => {
          setCustomCliCwd(config, "research", value);
        }
      }),
      stringSetting({
        id: "customCliResearchEnv",
        label: "Research env",
        help: "Optional JSON object of string environment variables for the web_research command. Values can be literal strings, env var names, or !command.",
        getValue: (config) => formatCustomCliEnv(getCustomCliNative(config)?.research?.env),
        setValue: (config, value) => {
          setCustomCliEnv(config, "research", value);
        }
      }),
      ...requestPolicySettings()
    ]
  },
  exa: {
    settings: [
      apiKeySetting(),
      baseUrlSetting(),
      valuesSetting({
        id: "exaSearchType",
        label: "Search type",
        help: "Exa search mode. 'default' uses the SDK default.",
        values: [
          "default",
          "keyword",
          "neural",
          "auto",
          "hybrid",
          "fast",
          "instant",
          "deep",
          "deep-reasoning",
          "deep-max"
        ],
        getValue: (config) => readString2(getExaNative(config)?.type) ?? "default",
        setValue: (config, value) => {
          const native = ensureExaNative(config);
          if (value === "default") {
            delete native.type;
          } else {
            native.type = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "exaTextContents",
        label: "Text contents",
        help: "Whether Exa should include text contents in search results. 'default' uses the SDK default.",
        values: ["default", "true", "false"],
        getValue: (config) => {
          const contents = asJsonObject2(getExaNative(config)?.contents);
          return typeof contents?.text === "boolean" ? String(contents.text) : "default";
        },
        setValue: (config, value) => {
          const native = ensureExaNative(config);
          const contents = asJsonObject2(native.contents) ?? {};
          if (value === "default") {
            delete contents.text;
          } else {
            contents.text = value === "true";
          }
          if (Object.keys(contents).length === 0) {
            delete native.contents;
          } else {
            native.contents = contents;
          }
          cleanupEmpty(config, "native");
        }
      }),
      ...lifecyclePolicySettings()
    ]
  },
  gemini: {
    settings: [
      apiKeySetting(),
      valuesSetting({
        id: "geminiApiVersion",
        label: "API version",
        help: "Gemini API version. 'default' uses the SDK default beta endpoints.",
        values: ["default", "v1alpha", "v1beta", "v1"],
        getValue: (config) => getGeminiNative(config)?.apiVersion ?? "default",
        setValue: (config, value) => {
          const native = ensureGeminiNative(config);
          if (value === "default") {
            delete native.apiVersion;
          } else {
            native.apiVersion = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      stringSetting({
        id: "geminiSearchModel",
        label: "Search model",
        help: "Model used for Gemini search interactions.",
        getValue: (config) => getGeminiNative(config)?.searchModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "searchModel",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      stringSetting({
        id: "geminiAnswerModel",
        label: "Answer model",
        help: "Model used for grounded Gemini answers.",
        getValue: (config) => getGeminiNative(config)?.answerModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "answerModel",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      stringSetting({
        id: "geminiResearchAgent",
        label: "Research agent",
        help: "Agent used for Gemini deep research runs.",
        getValue: (config) => getGeminiNative(config)?.researchAgent,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "researchAgent",
            value
          );
          cleanupEmpty(config, "native");
        }
      }),
      ...lifecyclePolicySettings()
    ]
  },
  perplexity: {
    settings: [
      apiKeySetting(),
      baseUrlSetting()
    ]
  },
  parallel: {
    settings: [
      apiKeySetting(),
      baseUrlSetting(),
      valuesSetting({
        id: "parallelSearchMode",
        label: "Search mode",
        help: "Parallel search mode. 'default' uses the SDK default.",
        values: ["default", "agentic", "one-shot"],
        getValue: (config) => readString2(getParallelNative(config)?.search?.mode) ?? "default",
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.search = asJsonObject2(native.search) ?? {};
          if (value === "default") {
            delete native.search.mode;
          } else {
            native.search.mode = value;
          }
          cleanupNestedObjects(config);
        }
      }),
      valuesSetting({
        id: "parallelExtractExcerpts",
        label: "Extract excerpts",
        help: "Include excerpts in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) => getOnOffValue(
          readBoolean(getParallelNative(config)?.extract?.excerpts)
        ),
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.extract = asJsonObject2(native.extract) ?? {};
          if (value === "default") {
            delete native.extract.excerpts;
          } else {
            native.extract.excerpts = value === "on";
          }
          cleanupNestedObjects(config);
        }
      }),
      valuesSetting({
        id: "parallelExtractFullContent",
        label: "Extract full content",
        help: "Include full page content in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) => getOnOffValue(
          readBoolean(getParallelNative(config)?.extract?.full_content)
        ),
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.extract = asJsonObject2(native.extract) ?? {};
          if (value === "default") {
            delete native.extract.full_content;
          } else {
            native.extract.full_content = value === "on";
          }
          cleanupNestedObjects(config);
        }
      })
    ]
  },
  valyu: {
    settings: [
      apiKeySetting(),
      baseUrlSetting(),
      valuesSetting({
        id: "valyuSearchType",
        label: "Search type",
        help: "Valyu search type. 'default' uses the SDK default.",
        values: ["default", "all", "web", "proprietary", "news"],
        getValue: (config) => readString2(getValyuNative(config)?.searchType) ?? "default",
        setValue: (config, value) => {
          const native = ensureValyuNative(config);
          if (value === "default") {
            delete native.searchType;
          } else {
            native.searchType = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      valuesSetting({
        id: "valyuResponseLength",
        label: "Response length",
        help: "Valyu response length. 'default' uses the SDK default.",
        values: ["default", "short", "medium", "large", "max"],
        getValue: (config) => readString2(getValyuNative(config)?.responseLength) ?? "default",
        setValue: (config, value) => {
          const native = ensureValyuNative(config);
          if (value === "default") {
            delete native.responseLength;
          } else {
            native.responseLength = value;
          }
          cleanupEmpty(config, "native");
        }
      }),
      ...lifecyclePolicySettings()
    ]
  }
};
function getProviderConfigManifest(providerId) {
  return PROVIDER_CONFIG_MANIFESTS[providerId];
}
function stringSetting(setting) {
  return {
    kind: "text",
    ...setting
  };
}
function valuesSetting(setting) {
  return {
    kind: "values",
    ...setting
  };
}
function jsonArraySetting(setting) {
  return {
    kind: "text",
    ...setting
  };
}
function apiKeySetting() {
  return stringSetting({
    id: "apiKey",
    label: "API key",
    help: "Provider API key. You can use a literal value, an env var name like EXA_API_KEY, or !command.",
    secret: true,
    getValue: (config) => config?.apiKey,
    setValue: (config, value) => {
      assignOptionalString(
        config,
        "apiKey",
        value
      );
    }
  });
}
function baseUrlSetting() {
  return stringSetting({
    id: "baseUrl",
    label: "Base URL",
    help: "Optional API base URL override.",
    getValue: (config) => config?.baseUrl,
    setValue: (config, value) => {
      assignOptionalString(
        config,
        "baseUrl",
        value
      );
    }
  });
}
function requestPolicySettings() {
  return [
    integerSetting({
      id: "requestTimeoutMs",
      label: "Request timeout (ms)",
      help: "Maximum time to wait for each command before failing that attempt for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Request timeout must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.requestTimeoutMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "requestTimeoutMs",
          value,
          "Request timeout must be a positive integer."
        );
        cleanupEmpty(config, "policy");
      }
    }),
    integerSetting({
      id: "retryCount",
      label: "Retry count",
      help: "How many times to retry transient command failures for this provider. Leave empty to inherit the generic setting.",
      minimum: 0,
      errorMessage: "Retry count must be a non-negative integer.",
      getValue: (config) => getIntegerString(config?.policy?.retryCount),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "retryCount",
          value,
          "Retry count must be a non-negative integer.",
          { allowZero: true }
        );
        cleanupEmpty(config, "policy");
      }
    }),
    integerSetting({
      id: "retryDelayMs",
      label: "Retry delay (ms)",
      help: "Initial delay before retrying command failures for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Retry delay must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.retryDelayMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "retryDelayMs",
          value,
          "Retry delay must be a positive integer."
        );
        cleanupEmpty(config, "policy");
      }
    })
  ];
}
function lifecyclePolicySettings() {
  return [
    integerSetting({
      id: "researchPollIntervalMs",
      label: "Research poll interval (ms)",
      help: "How often to poll long-running research jobs for updates for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Research poll interval must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.researchPollIntervalMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchPollIntervalMs",
          value,
          "Research poll interval must be a positive integer."
        );
        cleanupEmpty(config, "policy");
      }
    }),
    integerSetting({
      id: "researchTimeoutMs",
      label: "Research timeout (ms)",
      help: "Maximum total time to wait for research before returning a resumable timeout error for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Research timeout must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.researchTimeoutMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchTimeoutMs",
          value,
          "Research timeout must be a positive integer."
        );
        cleanupEmpty(config, "policy");
      }
    }),
    integerSetting({
      id: "researchMaxConsecutivePollErrors",
      label: "Max poll errors",
      help: "How many consecutive poll failures to tolerate before stopping the local research run for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Max poll errors must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.researchMaxConsecutivePollErrors),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchMaxConsecutivePollErrors",
          value,
          "Max poll errors must be a positive integer."
        );
        cleanupEmpty(config, "policy");
      }
    })
  ];
}
function integerSetting(setting) {
  const { minimum: _minimum, errorMessage: _errorMessage, ...rest } = setting;
  return {
    kind: "text",
    ...rest
  };
}
function assignOptionalString(target, key, value) {
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
  } else {
    target[key] = trimmed;
  }
}
function assignOptionalInteger(target, key, value, errorMessage, options) {
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
    return;
  }
  const parsed = Number(trimmed);
  const minimum = options?.allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(errorMessage);
  }
  target[key] = parsed;
}
function assignOptionalBoolean(target, key, value) {
  if (value === "default") {
    delete target[key];
  } else {
    target[key] = value === "true";
  }
}
function getIntegerString(value) {
  return typeof value === "number" ? String(value) : void 0;
}
function getBooleanValue(value) {
  return typeof value === "boolean" ? String(value) : "default";
}
function getOnOffValue(value) {
  if (value === void 0) {
    return "default";
  }
  return value ? "on" : "off";
}
function readString2(value) {
  return typeof value === "string" ? value : void 0;
}
function readBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asJsonObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function ensurePolicy(config) {
  config.policy = { ...config.policy ?? {} };
  return config.policy;
}
function cleanupEmpty(config, key) {
  const value = asJsonObject2(config[key]);
  if (value && Object.keys(value).length === 0) {
    delete config[key];
  }
}
function cleanupNestedObjects(config) {
  const native = config.native;
  if (!native) {
    return;
  }
  if (native.search && Object.keys(native.search).length === 0) {
    delete native.search;
  }
  if (native.extract && Object.keys(native.extract).length === 0) {
    delete native.extract;
  }
  cleanupEmpty(config, "native");
}
function getClaudeNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureClaudeNative(config) {
  config.native = { ...config.native ?? config.defaults ?? {} };
  delete config.defaults;
  return config.native;
}
function getCodexNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureCodexNative(config) {
  config.native = { ...config.native ?? config.defaults ?? {} };
  delete config.defaults;
  return config.native;
}
function getGeminiNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureGeminiNative(config) {
  config.native = { ...config.native ?? config.defaults ?? {} };
  delete config.defaults;
  return config.native;
}
function getCustomCliNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureCustomCliNative(config) {
  const native = getCustomCliNative(config);
  config.native = {
    ...native?.search ? { search: { ...native.search } } : {},
    ...native?.contents ? { contents: { ...native.contents } } : {},
    ...native?.answer ? { answer: { ...native.answer } } : {},
    ...native?.research ? { research: { ...native.research } } : {}
  };
  delete config.defaults;
  return config.native;
}
function formatCustomCliEnv(env) {
  return env ? JSON.stringify(env) : void 0;
}
function setCustomCliArgv(config, capability, value) {
  const trimmed = value.trim();
  const native = ensureCustomCliNative(config);
  if (!trimmed) {
    delete native[capability];
    cleanupCustomCliNative(config);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Custom CLI ${capability} argv must be a JSON string array: ${error.message}`
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(
    (entry) => typeof entry !== "string" || entry.trim().length === 0
  )) {
    throw new Error(
      `Custom CLI ${capability} argv must be a non-empty JSON string array.`
    );
  }
  native[capability] = {
    ...native[capability] ?? {},
    argv: parsed
  };
  cleanupCustomCliNative(config);
}
function setCustomCliCwd(config, capability, value) {
  const native = ensureCustomCliNative(config);
  const command = { ...native[capability] ?? {} };
  assignOptionalString(
    command,
    "cwd",
    value
  );
  native[capability] = command;
  cleanupCustomCliNative(config);
}
function setCustomCliEnv(config, capability, value) {
  const trimmed = value.trim();
  const native = ensureCustomCliNative(config);
  const command = { ...native[capability] ?? {} };
  if (!trimmed) {
    delete command.env;
  } else {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Custom CLI ${capability} env must be a JSON object of strings: ${error.message}`
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((entry) => typeof entry !== "string")) {
      throw new Error(
        `Custom CLI ${capability} env must be a JSON object of strings.`
      );
    }
    command.env = parsed;
  }
  native[capability] = command;
  cleanupCustomCliNative(config);
}
function cleanupCustomCliNative(config) {
  const native = config.native;
  if (!native) {
    return;
  }
  for (const capability of [
    "search",
    "contents",
    "answer",
    "research"
  ]) {
    const entry = native[capability];
    if (!entry) {
      continue;
    }
    if (entry.argv === void 0 && entry.cwd === void 0 && (entry.env === void 0 || Object.keys(entry.env).length === 0)) {
      delete native[capability];
    }
  }
  cleanupEmpty(config, "native");
}
function getParallelNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureParallelNative(config) {
  const search = asJsonObject2(config.native?.search ?? config.defaults?.search);
  const extract = asJsonObject2(
    config.native?.extract ?? config.defaults?.extract
  );
  config.native = {
    ...search ? { search } : {},
    ...extract ? { extract } : {}
  };
  delete config.defaults;
  return config.native;
}
function getExaNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureExaNative(config) {
  config.native = { ...config.native ?? config.defaults ?? {} };
  delete config.defaults;
  return config.native;
}
function getValyuNative(config) {
  return config?.native ?? config?.defaults;
}
function ensureValyuNative(config) {
  config.native = { ...config.native ?? config.defaults ?? {} };
  delete config.defaults;
  return config.native;
}

// src/index.ts
var DEFAULT_MAX_RESULTS = 5;
var MAX_ALLOWED_RESULTS = 20;
var MAX_SEARCH_QUERIES = 10;
var RESEARCH_HEARTBEAT_MS = 15e3;
var CAPABILITY_TOOL_NAMES = {
  search: "web_search",
  contents: "web_contents",
  answer: "web_answer",
  research: "web_research"
};
var MANAGED_TOOL_NAMES = Object.values(CAPABILITY_TOOL_NAMES);
function webProvidersExtension(pi) {
  registerManagedTools(pi);
  pi.registerCommand("web-providers", {
    description: "Configure web search providers",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("web-providers requires interactive mode", "error");
        return;
      }
      await runWebProvidersConfig(pi, ctx);
    }
  });
  pi.on("session_start", async (_event, ctx) => {
    resetContentStore();
    await refreshManagedTools(pi, ctx.cwd, { addAvailable: true });
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    await cleanupContentStore();
    await refreshManagedTools(pi, ctx.cwd, { addAvailable: false });
  });
}
function registerManagedTools(pi, providerIdsByCapability = {}) {
  registerWebSearchTool(pi, providerIdsByCapability.search ?? PROVIDER_IDS);
  registerWebContentsTool(
    pi,
    providerIdsByCapability.contents ?? getProviderIdsForCapability("contents")
  );
  registerWebAnswerTool(
    pi,
    providerIdsByCapability.answer ?? getProviderIdsForCapability("answer")
  );
  registerWebResearchTool(
    pi,
    providerIdsByCapability.research ?? getProviderIdsForCapability("research")
  );
}
function registerWebSearchTool(pi, providerIds) {
  const visibleProviderIds = providerIds.length > 0 ? providerIds : PROVIDER_IDS;
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Find likely sources on the public web for up to ${MAX_SEARCH_QUERIES} queries in a single call and return titles, URLs, and snippets grouped by query. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} when needed.`,
    promptGuidelines: [
      "Prefer batching related searches into one web_search call instead of making multiple calls."
    ],
    parameters: Type.Object({
      queries: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: MAX_SEARCH_QUERIES,
        description: `One or more search queries to run in one call (max ${MAX_SEARCH_QUERIES})`
      }),
      maxResults: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_ALLOWED_RESULTS,
          description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS})`
        })
      ),
      options: jsonOptionsSchema(
        describeOptionsField("search", visibleProviderIds)
      )
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSearchTool({
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        maxResults: params.maxResults,
        queries: params.queries
      });
    },
    renderCall(args, theme) {
      return renderCallHeader(
        args,
        theme
      );
    },
    renderResult(result, state, theme) {
      return renderSearchToolResult(
        result,
        state.expanded,
        state.isPartial,
        theme
      );
    }
  });
}
function registerWebContentsTool(pi, providerIds) {
  if (providerIds.length === 0) return;
  pi.registerTool({
    name: "web_contents",
    label: "Web Contents",
    description: "Read and extract the main contents of one or more web pages.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "One or more URLs to extract"
      }),
      options: jsonOptionsSchema(describeOptionsField("contents", providerIds))
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "contents",
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        urls: params.urls
      });
    },
    renderCall(args, theme) {
      return renderListCallHeader(
        "web_contents",
        Array.isArray(args.urls) ? args.urls ?? [] : [],
        theme
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_contents failed",
        theme
      );
    }
  });
}
function registerWebAnswerTool(pi, providerIds) {
  if (providerIds.length === 0) return;
  pi.registerTool({
    name: "web_answer",
    label: "Web Answer",
    description: `Answer one or more questions using web-grounded evidence (up to ${MAX_SEARCH_QUERIES} per call).`,
    parameters: Type.Object({
      queries: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: MAX_SEARCH_QUERIES,
        description: `One or more questions to answer in one call (max ${MAX_SEARCH_QUERIES})`
      }),
      options: jsonOptionsSchema(describeOptionsField("answer", providerIds))
    }),
    promptGuidelines: [
      "Prefer batching related questions into one web_answer call instead of making multiple calls."
    ],
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeAnswerTool({
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        queries: params.queries
      });
    },
    renderCall(args, theme) {
      return renderQuestionCallHeader(
        {
          queries: Array.isArray(args.queries) ? args.queries ?? [] : []
        },
        theme
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_answer failed",
        theme,
        { markdownWhenExpanded: true }
      );
    }
  });
}
function registerWebResearchTool(pi, providerIds) {
  if (providerIds.length === 0) return;
  pi.registerTool({
    name: "web_research",
    label: "Web Research",
    description: "Investigate a topic across web sources and produce a longer report.",
    parameters: Type.Object({
      input: Type.String({ description: "Research brief or question" }),
      options: jsonOptionsSchema(describeOptionsField("research", providerIds))
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "research",
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        input: params.input
      });
    },
    renderCall(args, theme) {
      return renderResearchCallHeader(
        {
          input: String(args.input ?? "")
        },
        theme
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_research failed",
        theme
      );
    }
  });
}
async function runWebProvidersConfig(pi, ctx) {
  const config = await loadConfig();
  const activeProvider = getInitialProviderSelection(config);
  await ctx.ui.custom(
    (tui, theme, _keybindings, done) => new WebProvidersSettingsView(
      tui,
      theme,
      done,
      ctx,
      config,
      activeProvider
    )
  );
  await refreshManagedTools(pi, ctx.cwd, { addAvailable: true });
}
function getAvailableProviderIdsForCapability(config, cwd, capability) {
  const providerId = getMappedProviderIdForCapability(config, capability);
  if (!providerId) {
    return [];
  }
  try {
    resolveProviderForCapability(config, cwd, capability);
    return [providerId];
  } catch {
    return [];
  }
}
function getAvailableManagedToolNames(config, cwd) {
  return Object.keys(CAPABILITY_TOOL_NAMES).filter(
    (capability) => getAvailableProviderIdsForCapability(config, cwd, capability).length > 0
  ).map((capability) => CAPABILITY_TOOL_NAMES[capability]);
}
function getSyncedActiveTools(config, cwd, activeToolNames, options) {
  const availableToolNames = new Set(getAvailableManagedToolNames(config, cwd));
  const nextActiveTools = new Set(activeToolNames);
  for (const toolName of MANAGED_TOOL_NAMES) {
    if (availableToolNames.has(toolName)) {
      if (options.addAvailable) {
        nextActiveTools.add(toolName);
      }
      continue;
    }
    nextActiveTools.delete(toolName);
  }
  return nextActiveTools;
}
async function refreshManagedTools(pi, cwd, options) {
  const config = await loadConfig();
  const nextActiveTools = getSyncedActiveTools(
    config,
    cwd,
    pi.getActiveTools(),
    options
  );
  registerManagedTools(pi, {
    search: getAvailableProviderIdsForCapability(config, cwd, "search"),
    contents: getAvailableProviderIdsForCapability(config, cwd, "contents"),
    answer: getAvailableProviderIdsForCapability(config, cwd, "answer"),
    research: getAvailableProviderIdsForCapability(config, cwd, "research")
  });
  await syncManagedToolAvailability(pi, nextActiveTools);
}
async function syncManagedToolAvailability(pi, nextActiveTools) {
  const activeTools = pi.getActiveTools();
  const changed = activeTools.length !== nextActiveTools.size || activeTools.some((toolName) => !nextActiveTools.has(toolName));
  if (changed) {
    pi.setActiveTools(Array.from(nextActiveTools));
  }
}
function getProviderIdsForCapability(capability) {
  return PROVIDERS.filter(
    (provider) => supportsProviderCapability(provider, capability)
  ).map((provider) => provider.id);
}
function jsonOptionsSchema(description) {
  return Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description
      }
    )
  );
}
function describeOptionsField(capability, providerIds) {
  const labels = {
    search: "Provider-specific search options.",
    contents: "Provider-specific extraction options.",
    answer: "Provider-specific answer options.",
    research: "Provider-specific research options."
  };
  const supportedControls = getSupportedExecutionControlsForCapability(
    capability,
    providerIds
  );
  let description = labels[capability];
  if (supportedControls.length > 0) {
    const qualifier = capability === "research" ? " Depending on provider, local execution controls may include: " : " Local execution controls: ";
    description += `${qualifier}${supportedControls.join(", ")}.`;
  }
  if (capability === "search") {
    description += " Local orchestration options may include prefetch={ provider, maxUrls, ttlMs, contentsOptions }. Prefetch runs only when prefetch.provider is set.";
  }
  return description;
}
function getSupportedExecutionControlsForCapability(capability, providerIds) {
  const supportedControls = /* @__PURE__ */ new Set();
  for (const providerId of providerIds) {
    const provider = PROVIDER_MAP[providerId];
    const plan = provider.buildPlan(
      createExecutionSupportProbeRequest(capability),
      provider.createTemplate()
    );
    if (!plan) {
      continue;
    }
    const executionSupport = resolvePlanExecutionSupport(plan);
    for (const key of EXECUTION_CONTROL_KEYS) {
      if (executionSupport[key] === true) {
        supportedControls.add(key);
      }
    }
  }
  return EXECUTION_CONTROL_KEYS.filter((key) => supportedControls.has(key));
}
function createExecutionSupportProbeRequest(capability) {
  switch (capability) {
    case "search":
      return {
        capability,
        query: "Describe execution controls",
        maxResults: 1
      };
    case "contents":
      return {
        capability,
        urls: ["https://example.com"]
      };
    case "answer":
      return {
        capability,
        query: "Describe execution controls"
      };
    case "research":
      return {
        capability,
        input: "Describe execution controls"
      };
  }
}
async function executeSearchTool({
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  maxResults,
  queries,
  planOverrides
}) {
  await cleanupContentStore();
  const provider = resolveProviderChoice(config, ctx.cwd, explicitProvider);
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }
  const prefetchOptions = mergeSearchContentsPrefetchOptions(
    getSearchPrefetchDefaults(config),
    parseSearchContentsPrefetchOptions(options)
  );
  const providerOptions = stripSearchContentsPrefetchOptions(options);
  const searchQueries = resolveSearchQueries(queries);
  if (planOverrides !== void 0 && planOverrides.length !== searchQueries.length) {
    throw new Error(
      "planOverrides length must match the number of search queries."
    );
  }
  const progress = createToolProgressReporter("search", provider.id, onUpdate);
  const providerContext = {
    cwd: ctx.cwd,
    signal: signal ?? void 0
  };
  const clampedMaxResults = clampResults(maxResults);
  let outcomes;
  try {
    const settled = await Promise.allSettled(
      searchQueries.map(
        (searchQuery, index) => executeSingleSearchQuery({
          provider,
          providerConfig,
          query: searchQuery,
          maxResults: clampedMaxResults,
          options: providerOptions,
          providerContext,
          onProgress: createBatchProgressReporter(
            progress.report,
            searchQueries,
            index
          ),
          planOverride: planOverrides?.[index]
        })
      )
    );
    outcomes = settled.map(
      (result, index) => result.status === "fulfilled" ? { query: searchQueries[index] ?? "", response: result.value } : {
        query: searchQueries[index] ?? "",
        error: formatErrorMessage(result.reason)
      }
    );
  } finally {
    progress.stop();
  }
  if (outcomes.every((outcome) => outcome.error !== void 0)) {
    throw buildSearchBatchError(outcomes);
  }
  const prefetch = prefetchOptions !== void 0 && planOverrides === void 0 ? await startContentsPrefetch({
    config,
    cwd: ctx.cwd,
    urls: collectSearchResultUrls(outcomes),
    options: prefetchOptions
  }) : void 0;
  const rendered = await truncateAndSave(
    formatSearchResponses(outcomes, prefetch),
    "web-search"
  );
  return {
    content: [{ type: "text", text: rendered }],
    details: buildWebSearchDetails(provider.id, outcomes)
  };
}
function buildSearchBatchError(outcomes) {
  const failed = outcomes.filter((outcome) => outcome.error !== void 0);
  if (failed.length === 1) {
    return new Error(failed[0]?.error ?? "web_search failed.");
  }
  const summary = failed.map(
    (outcome, index) => `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} \u2014 ${outcome.error}`
  ).join("; ");
  return new Error(
    `All ${failed.length} web_search queries failed: ${summary}`
  );
}
async function executeSingleSearchQuery({
  provider,
  providerConfig,
  query: query2,
  maxResults,
  options,
  providerContext,
  onProgress,
  planOverride
}) {
  const plan = planOverride ?? buildProviderPlan(provider, providerConfig, {
    capability: "search",
    query: query2,
    maxResults,
    options: stripLocalExecutionOptions(options)
  });
  const result = await executeOperationPlan(plan, options, {
    ...providerContext,
    onProgress
  });
  if (!isSearchResponse(result)) {
    throw new Error(`${provider.label} search returned an invalid result.`);
  }
  return result;
}
async function executeAnswerTool({
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  queries,
  planOverrides
}) {
  const provider = resolveProviderForCapability(
    config,
    ctx.cwd,
    "answer",
    explicitProvider
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }
  const answerQueries = resolveAnswerQueries(queries);
  if (planOverrides !== void 0 && planOverrides.length !== answerQueries.length) {
    throw new Error(
      "planOverrides length must match the number of answer queries."
    );
  }
  const progress = createToolProgressReporter("answer", provider.id, onUpdate);
  const providerContext = {
    cwd: ctx.cwd,
    signal: signal ?? void 0
  };
  let outcomes;
  try {
    const settled = await Promise.allSettled(
      answerQueries.map(
        (answerQuery, index) => executeProviderOperation({
          capability: "answer",
          config,
          provider,
          providerConfig,
          ctx,
          signal,
          options,
          query: answerQuery,
          onProgress: createBatchProgressReporter(
            progress.report,
            answerQueries,
            index
          ),
          planOverride: planOverrides?.[index]
        })
      )
    );
    outcomes = settled.map(
      (result, index) => result.status === "fulfilled" ? { query: answerQueries[index] ?? "", response: result.value } : {
        query: answerQueries[index] ?? "",
        error: formatErrorMessage(result.reason)
      }
    );
  } finally {
    progress.stop();
  }
  if (outcomes.every((outcome) => outcome.error !== void 0)) {
    throw buildAnswerBatchError(outcomes);
  }
  const text = await truncateAndSave(
    formatAnswerResponses(outcomes),
    "web-answer"
  );
  const details = buildWebAnswerDetails(provider.id, outcomes);
  return {
    content: [{ type: "text", text }],
    details
  };
}
function buildAnswerBatchError(outcomes) {
  const failed = outcomes.filter((outcome) => outcome.error !== void 0);
  if (failed.length === 1) {
    return new Error(failed[0]?.error ?? "web_answer failed.");
  }
  const summary = failed.map(
    (outcome, index) => `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} \u2014 ${outcome.error}`
  ).join("; ");
  return new Error(
    `All ${failed.length} web_answer queries failed: ${summary}`
  );
}
function formatAnswerResponses(outcomes) {
  return outcomes.map(
    (outcome, index) => formatAnswerOutcomeSection(outcome, index, outcomes.length)
  ).join("\n\n");
}
function formatAnswerOutcomeSection(outcome, index, total) {
  const heading = total > 1 ? `## Question ${index + 1}: ${formatAnswerHeading(outcome.query)}` : `## ${formatAnswerHeading(outcome.query)}`;
  const body = outcome.response ? outcome.response.text : `Answer failed: ${outcome.error ?? "Unknown error."}`;
  return `${heading}

${body}`;
}
function buildWebAnswerDetails(provider, outcomes) {
  const successfulOutcomes = outcomes.filter(
    (outcome) => outcome.response !== void 0
  );
  const summary = successfulOutcomes.length === 1 && outcomes.length === 1 ? successfulOutcomes[0]?.response.summary : void 0;
  return {
    tool: "web_answer",
    provider,
    summary,
    itemCount: successfulOutcomes.length === 1 ? successfulOutcomes[0]?.response.itemCount : void 0,
    queryCount: outcomes.length,
    failedQueryCount: outcomes.filter((outcome) => outcome.error !== void 0).length
  };
}
async function executeProviderOperation({
  capability,
  config,
  provider,
  providerConfig,
  ctx,
  signal,
  options,
  urls,
  query: query2,
  input,
  onProgress,
  planOverride
}) {
  const plan = planOverride ?? buildProviderPlan(
    provider,
    providerConfig,
    buildOperationRequest(capability, {
      urls,
      query: query2,
      input,
      options: stripLocalExecutionOptions(options)
    })
  );
  if (capability === "contents" && planOverride === void 0) {
    const resolved = await resolveContentsFromStore({
      urls: urls ?? [],
      providerId: provider.id,
      config,
      cwd: ctx.cwd,
      options,
      signal: signal ?? void 0,
      onProgress
    });
    return resolved.output;
  }
  const result = await executeOperationPlan(plan, options, {
    cwd: ctx.cwd,
    signal: signal ?? void 0,
    onProgress
  });
  if (isSearchResponse(result)) {
    throw new Error(
      `${provider.label} ${capability} returned an invalid result.`
    );
  }
  return result;
}
async function executeProviderTool({
  capability,
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  urls,
  query: query2,
  input,
  planOverride
}) {
  await cleanupContentStore();
  const provider = resolveProviderForCapability(
    config,
    ctx.cwd,
    capability,
    explicitProvider
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }
  const progress = createToolProgressReporter(
    capability,
    provider.id,
    onUpdate
  );
  let response;
  try {
    response = await executeProviderOperation({
      capability,
      config,
      provider,
      providerConfig,
      ctx,
      signal,
      options,
      urls,
      query: query2,
      input,
      onProgress: progress.report,
      planOverride
    });
  } finally {
    progress.stop();
  }
  const details = {
    tool: `web_${capability}`,
    provider: response.provider,
    summary: response.summary,
    itemCount: response.itemCount
  };
  const text = await truncateAndSave(response.text, capability);
  return {
    content: [{ type: "text", text }],
    details
  };
}
function buildOperationRequest(capability, args) {
  if (capability === "contents") {
    return {
      capability,
      urls: args.urls ?? [],
      options: args.options
    };
  }
  if (capability === "answer") {
    return {
      capability,
      query: args.query ?? "",
      options: args.options
    };
  }
  return {
    capability,
    input: args.input ?? "",
    options: args.options
  };
}
function buildProviderPlan(provider, providerConfig, request) {
  const plan = provider.buildPlan(request, providerConfig);
  if (!plan) {
    throw new Error(
      `Provider '${provider.id}' could not build a plan for '${request.capability}'.`
    );
  }
  return plan;
}
function isSearchResponse(value) {
  return "results" in value;
}
function normalizeOptions(value) {
  return isJsonObject3(value) ? value : void 0;
}
function createToolProgressReporter(capability, providerId, onUpdate) {
  if (!onUpdate) {
    return { report: void 0, stop: () => {
    } };
  }
  const emit = (message) => onUpdate({
    content: [{ type: "text", text: message }],
    details: {}
  });
  const startedAt = Date.now();
  let lastUpdateAt = startedAt;
  let timer;
  if (capability === "research") {
    timer = setInterval(() => {
      if (Date.now() - lastUpdateAt < RESEARCH_HEARTBEAT_MS) {
        return;
      }
      const providerLabel = PROVIDER_MAP[providerId]?.label ?? providerId;
      const elapsed = formatElapsed(Date.now() - startedAt);
      emit(`Researching via ${providerLabel} (${elapsed} elapsed)`);
      lastUpdateAt = Date.now();
    }, RESEARCH_HEARTBEAT_MS);
  }
  return {
    report: (message) => {
      lastUpdateAt = Date.now();
      emit(message);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
      }
    }
  };
}
function renderListCallHeader(toolName, items, theme, options = {}) {
  return {
    invalidate() {
    },
    render(width) {
      const normalizedItems = items.map((item) => cleanSingleLine(item)).filter((item) => item.length > 0);
      const showItemsInline = normalizedItems.length === 1 && options.forceMultiline !== true;
      let header = theme.fg("toolTitle", theme.bold(toolName));
      if (showItemsInline) {
        const singleItem = options.singleItemFormatter?.(normalizedItems[0]) ?? normalizedItems[0];
        header += ` ${theme.fg("accent", singleItem)}`;
      }
      if (options.suffix) {
        header += theme.fg("muted", options.suffix);
      }
      const lines = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine)))
      );
      if (normalizedItems.length > (showItemsInline ? 1 : 0)) {
        for (const item of normalizedItems) {
          const renderedItem = options.multiItemFormatter?.(item) ?? truncateInline(item, 120);
          const itemLine = truncateToWidth(
            `  ${theme.fg("accent", renderedItem)}`,
            width
          );
          lines.push(
            itemLine + " ".repeat(Math.max(0, width - visibleWidth(itemLine)))
          );
        }
      }
      return lines;
    }
  };
}
function renderToolCallHeader(toolName, primary, details, theme) {
  return renderListCallHeader(
    toolName,
    primary.trim().length > 0 ? [primary] : [],
    theme,
    {
      singleItemFormatter: (item) => item,
      suffix: details.length > 0 ? ` ${details.join(" ")}` : void 0
    }
  );
}
function renderQuestionCallHeader(params, theme) {
  return renderListCallHeader(
    "web_answer",
    getAnswerQueriesForDisplay(params.queries),
    theme,
    {
      singleItemFormatter: (question) => formatQuotedPreview(question)
    }
  );
}
function renderResearchCallHeader(params, theme) {
  return renderListCallHeader("web_research", [params.input], theme, {
    forceMultiline: true
  });
}
function renderSearchToolResult(result, expanded, isPartial, theme) {
  const text = extractTextContent(result.content);
  const isError = Boolean(result.isError);
  if (isPartial) {
    return renderSimpleText(text ?? "Working\u2026", theme, "warning");
  }
  if (isError) {
    return renderBlockText(text ?? "web_search failed", theme, "error");
  }
  const details = result.details;
  if (!details || expanded) {
    return renderMarkdownBlock(text ?? "");
  }
  return renderCollapsedSearchSummary(details, text, theme);
}
function renderProviderToolResult(result, expanded, isPartial, failureText, theme, options = {}) {
  const text = extractTextContent(result.content);
  if (isPartial) {
    return renderSimpleText(text ?? "Working\u2026", theme, "warning");
  }
  if (result.isError) {
    return renderBlockText(text ?? failureText, theme, "error");
  }
  if (expanded) {
    return options.markdownWhenExpanded ? renderMarkdownBlock(text ?? "") : renderBlockText(text ?? "", theme, "toolOutput");
  }
  const details = result.details;
  const summary = renderCollapsedProviderToolSummary(details, text);
  let summaryText = theme.fg("success", summary);
  summaryText += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summaryText, 0, 0);
}
function renderCollapsedProviderToolSummary(details, text) {
  if (details?.tool === "web_answer" && typeof details.queryCount === "number" && details.queryCount > 1) {
    const providerLabel = PROVIDER_MAP[details.provider]?.label ?? details.provider;
    const failureSuffix = details.failedQueryCount && details.failedQueryCount > 0 ? `, ${details.failedQueryCount} failed` : "";
    return `${details.queryCount} questions via ${providerLabel}${failureSuffix}`;
  }
  const baseSummary = getCompactProviderToolSummary(details) ?? details?.summary ?? getFirstLine(text) ?? `${details?.tool ?? "tool"} output available`;
  if (!details?.provider) {
    return baseSummary;
  }
  return appendProviderSummary(baseSummary, details.provider);
}
function getCompactProviderToolSummary(details) {
  if (!details) {
    return void 0;
  }
  if (details.tool === "web_contents" && typeof details.itemCount === "number") {
    return `${details.itemCount} page${details.itemCount === 1 ? "" : "s"}`;
  }
  return void 0;
}
function getProviderSettings(providerId) {
  return getProviderConfigManifest(providerId).settings;
}
function getEnabledCompatibleProvidersForTool(config, cwd, toolId) {
  return getCompatibleProvidersForTool(toolId).filter((providerId) => {
    const providerConfig = config.providers?.[providerId];
    if (providerConfig?.enabled !== true) {
      return false;
    }
    return PROVIDER_MAP[providerId].getStatus(
      providerConfig,
      cwd,
      toolId
    ).available;
  });
}
function getSearchToolSettings(config) {
  return config.toolSettings?.search;
}
function getSearchPrefetchDefaults(config) {
  return getSearchToolSettings(config)?.prefetch;
}
var GENERIC_SETTING_IDS = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "researchPollIntervalMs",
  "researchTimeoutMs",
  "researchMaxConsecutivePollErrors"
];
var GENERIC_SETTING_META = {
  requestTimeoutMs: {
    label: "Request timeout (ms)",
    help: "Default maximum time to wait for a single provider request before failing that attempt. Applies to every provider unless overridden.",
    parse: (value) => parseOptionalPositiveIntegerInput(
      value,
      "Request timeout must be a positive integer."
    )
  },
  retryCount: {
    label: "Retry count",
    help: "Default number of times transient provider failures should be retried. Applies to every provider unless overridden.",
    parse: (value) => parseOptionalNonNegativeIntegerInput(
      value,
      "Retry count must be a non-negative integer."
    )
  },
  retryDelayMs: {
    label: "Retry delay (ms)",
    help: "Default initial delay before retrying failed requests. Later retries back off automatically. Applies to every provider unless overridden.",
    parse: (value) => parseOptionalPositiveIntegerInput(
      value,
      "Retry delay must be a positive integer."
    )
  },
  researchPollIntervalMs: {
    label: "Research poll interval (ms)",
    help: "Default poll interval for long-running research jobs. Applies to research-capable providers unless overridden.",
    parse: (value) => parseOptionalPositiveIntegerInput(
      value,
      "Research poll interval must be a positive integer."
    )
  },
  researchTimeoutMs: {
    label: "Research timeout (ms)",
    help: "Default maximum total time to wait for research before returning a resumable timeout error. Applies to research-capable providers unless overridden.",
    parse: (value) => parseOptionalPositiveIntegerInput(
      value,
      "Research timeout must be a positive integer."
    )
  },
  researchMaxConsecutivePollErrors: {
    label: "Max poll errors",
    help: "Default number of consecutive poll failures to tolerate before stopping a local research run. Applies to research-capable providers unless overridden.",
    parse: (value) => parseOptionalPositiveIntegerInput(
      value,
      "Max poll errors must be a positive integer."
    )
  }
};
function getGenericSettingValue(config, id) {
  const explicitValue = config.genericSettings?.[id];
  if (typeof explicitValue === "number") {
    return explicitValue;
  }
  const values = /* @__PURE__ */ new Set();
  for (const providerId of PROVIDER_IDS) {
    const value = config.providers?.[providerId]?.policy?.[id];
    if (typeof value === "number") {
      values.add(value);
      if (values.size > 1) {
        return "mixed";
      }
    }
  }
  const [onlyValue] = values;
  return onlyValue;
}
function getGenericSettingDisplayValue(config, id) {
  const value = getGenericSettingValue(config, id);
  if (value === "mixed") {
    return "mixed";
  }
  return summarizeStringValue(
    typeof value === "number" ? String(value) : void 0,
    false
  );
}
function getGenericSettingRawValue(config, id) {
  const value = getGenericSettingValue(config, id);
  return typeof value === "number" ? String(value) : "";
}
function ensureGenericSettings(config) {
  config.genericSettings = { ...config.genericSettings ?? {} };
  return config.genericSettings;
}
function cleanupGenericSettings(config) {
  if (config.genericSettings && Object.keys(config.genericSettings).length === 0) {
    delete config.genericSettings;
  }
}
function stripGenericPolicyDuplicates(config) {
  for (const providerId of PROVIDER_IDS) {
    const providerConfig = config.providers?.[providerId];
    if (!providerConfig?.policy) {
      continue;
    }
    for (const key of GENERIC_SETTING_IDS) {
      if (providerConfig.policy[key] === config.genericSettings?.[key]) {
        delete providerConfig.policy[key];
      }
    }
    if (Object.keys(providerConfig.policy).length === 0) {
      delete providerConfig.policy;
    }
  }
}
var WebProvidersSettingsView = class {
  constructor(tui, theme, done, ctx, initialConfig, initialProvider) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.ctx = ctx;
    this.config = structuredClone(initialConfig);
    this.activeProvider = initialProvider;
    this.selection.provider = Math.max(
      0,
      PROVIDERS.findIndex((provider) => provider.id === initialProvider)
    );
  }
  config;
  activeProvider;
  activeSection = "tools";
  selection = {
    provider: 0,
    tools: 0,
    generic: 0
  };
  submenu;
  render(width) {
    if (this.submenu) {
      return this.submenu.render(width);
    }
    const lines = [];
    const toolItems = this.buildToolSectionItems();
    lines.push(...this.renderSection(width, "Tools", "tools", toolItems));
    lines.push("");
    const providerItems = this.buildProviderSectionItems();
    lines.push(
      ...this.renderSection(width, "Providers", "provider", providerItems)
    );
    lines.push("");
    const genericItems = this.buildGenericSectionItems();
    lines.push(
      ...this.renderSection(width, "Generic Settings", "generic", genericItems)
    );
    const selected = this.getSelectedEntry();
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2)
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }
    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg(
          "dim",
          "\u2191\u2193 move \xB7 Tab/Shift+Tab switch section \xB7 Enter edit/open \xB7 Esc close"
        ),
        width
      )
    );
    return lines;
  }
  invalidate() {
    this.submenu?.invalidate();
  }
  handleInput(data) {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }
    const kb = getEditorKeybindings();
    const entries = this.getActiveSectionEntries();
    if (kb.matches(data, "selectUp")) {
      if (entries.length > 0) {
        this.moveSelection(-1);
      }
    } else if (kb.matches(data, "selectDown")) {
      if (entries.length > 0) {
        this.moveSelection(1);
      }
    } else if (matchesKey(data, Key.tab)) {
      this.moveSection(1);
    } else if (matchesKey(data, Key.shift("tab"))) {
      this.moveSection(-1);
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done(void 0);
      return;
    }
    this.tui.requestRender();
  }
  buildProviderSectionItems() {
    return PROVIDERS.map((provider) => {
      const providerConfig = this.config.providers?.[provider.id];
      const status = provider.getStatus(providerConfig, this.ctx.cwd);
      const enabled = providerConfig?.enabled === true;
      return {
        id: `provider:${provider.id}`,
        label: provider.label,
        currentValue: enabled ? "on" : "off",
        description: provider.id === this.activeProvider ? `Press Enter to configure ${provider.label}'s provider-specific settings. Current status: ${status.summary}.` : `Move here and press Enter to configure ${provider.label}'s provider-specific settings. Current status: ${status.summary}.`,
        kind: "action"
      };
    });
  }
  buildToolSectionItems() {
    return Object.keys(CAPABILITY_TOOL_NAMES).map(
      (toolId) => {
        const enabledCompatibleProviders = getEnabledCompatibleProvidersForTool(
          this.config,
          this.ctx.cwd,
          toolId
        );
        const mappedProviderId = getMappedProviderIdForCapability(
          this.config,
          toolId
        );
        const currentValue = mappedProviderId && enabledCompatibleProviders.includes(mappedProviderId) ? PROVIDER_MAP[mappedProviderId].label : "off";
        const compatibleLabels = enabledCompatibleProviders.map(
          (providerId) => PROVIDER_MAP[providerId].label
        );
        return {
          id: `tool:${toolId}`,
          label: PROVIDER_TOOL_META[toolId].label,
          currentValue,
          description: `Press Enter to configure web_${toolId}. ${PROVIDER_TOOL_META[toolId].help} Route web_${toolId} to one compatible provider or turn it off.` + (compatibleLabels.length > 0 ? ` Enabled compatible providers: ${compatibleLabels.join(", ")}.` : ""),
          kind: "action"
        };
      }
    );
  }
  buildGenericSectionItems() {
    return GENERIC_SETTING_IDS.map((id) => ({
      id: `generic:${id}`,
      label: GENERIC_SETTING_META[id].label,
      currentValue: getGenericSettingDisplayValue(this.config, id),
      description: GENERIC_SETTING_META[id].help,
      kind: "text"
    }));
  }
  buildProviderItem(setting, providerConfig) {
    if (setting.kind === "values") {
      return {
        id: setting.id,
        label: setting.label,
        currentValue: setting.getValue(providerConfig),
        values: setting.values,
        description: setting.help,
        kind: "cycle"
      };
    }
    const currentValue = setting.getValue(providerConfig);
    return {
      id: setting.id,
      label: setting.label,
      currentValue: summarizeStringValue(currentValue, setting.secret === true),
      description: setting.help,
      kind: "text"
    };
  }
  getSectionEntries(section) {
    if (section === "provider") return this.buildProviderSectionItems();
    if (section === "generic") return this.buildGenericSectionItems();
    return this.buildToolSectionItems();
  }
  getActiveSectionEntries() {
    return this.getSectionEntries(this.activeSection);
  }
  getSelectedEntry() {
    const entries = this.getActiveSectionEntries();
    return entries[this.selection[this.activeSection]];
  }
  moveSection(direction) {
    const sections = [
      "tools",
      "provider",
      "generic"
    ];
    const index = sections.indexOf(this.activeSection);
    for (let offset = 1; offset <= sections.length; offset++) {
      const next = sections[(index + offset * direction + sections.length) % sections.length];
      if (this.getSectionEntries(next).length > 0) {
        this.activeSection = next;
        this.syncActiveProviderToSelection();
        return;
      }
    }
  }
  moveSelection(direction) {
    const sections = [
      "tools",
      "provider",
      "generic"
    ];
    const currentEntries = this.getActiveSectionEntries();
    const currentIndex = this.selection[this.activeSection];
    if (direction === -1 && currentIndex > 0) {
      this.selection[this.activeSection] = currentIndex - 1;
      this.syncActiveProviderToSelection();
      return;
    }
    if (direction === 1 && currentIndex < currentEntries.length - 1) {
      this.selection[this.activeSection] = currentIndex + 1;
      this.syncActiveProviderToSelection();
      return;
    }
    const startSectionIndex = sections.indexOf(this.activeSection);
    for (let offset = 1; offset <= sections.length; offset++) {
      const nextSection = sections[(startSectionIndex + offset * direction + sections.length) % sections.length];
      const nextEntries = this.getSectionEntries(nextSection);
      if (nextEntries.length === 0) continue;
      this.activeSection = nextSection;
      this.selection[nextSection] = direction === 1 ? 0 : nextEntries.length - 1;
      this.syncActiveProviderToSelection();
      return;
    }
  }
  syncActiveProviderToSelection() {
    if (this.activeSection !== "provider") {
      return;
    }
    const provider = PROVIDERS[this.selection.provider];
    if (!provider) {
      return;
    }
    this.activeProvider = provider.id;
  }
  renderSection(width, title, section, entries) {
    const lines = [
      truncateToWidth(
        this.activeSection === section ? this.theme.fg("accent", this.theme.bold(title)) : this.theme.bold(title),
        width
      )
    ];
    const labelWidth = Math.min(
      20,
      Math.max(...entries.map((entry) => entry.label.length), 0)
    );
    for (const [index, entry] of entries.entries()) {
      const selected = this.activeSection === section && this.selection[section] === index;
      const prefix = selected ? this.theme.fg("accent", "\u2192 ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected ? this.theme.fg("accent", paddedLabel) : paddedLabel;
      if (entry.currentValue.trim().length === 0) {
        lines.push(truncateToWidth(`${prefix}${label}`, width));
        continue;
      }
      const value = selected ? this.theme.fg("accent", entry.currentValue) : this.theme.fg("muted", entry.currentValue);
      lines.push(truncateToWidth(`${prefix}${label}  ${value}`, width));
    }
    return lines;
  }
  async activateCurrentEntry() {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    if (entry.id.startsWith("generic:")) {
      const settingId = entry.id.slice("generic:".length);
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        this.currentGenericSettingRawValue(settingId),
        entry.description,
        (selectedValue) => {
          this.submenu = void 0;
          if (selectedValue !== void 0) {
            void this.handleGenericSettingChange(settingId, selectedValue);
          }
          this.tui.requestRender();
        }
      );
      return;
    }
    if (entry.kind === "action" && entry.id.startsWith("tool:")) {
      const toolId = entry.id.slice("tool:".length);
      this.submenu = new ToolSettingsSubmenu(
        this.tui,
        this.theme,
        toolId,
        this.ctx.cwd,
        () => this.config,
        async (mutate) => {
          await this.persist(mutate);
        },
        () => {
          this.submenu = void 0;
          this.tui.requestRender();
        }
      );
      return;
    }
    if (entry.kind === "action" && entry.id.startsWith("provider:")) {
      const providerId = entry.id.slice("provider:".length);
      this.activeProvider = providerId;
      this.submenu = new ProviderSettingsSubmenu(
        this.tui,
        this.theme,
        providerId,
        () => this.currentProviderConfigFor(providerId),
        async (mutate) => {
          await this.persist((config) => {
            config.providers ??= {};
            const providerConfig = getEditableProviderConfig(
              providerId,
              config.providers?.[providerId]
            );
            mutate(providerConfig);
            config.providers[providerId] = providerConfig;
          });
        },
        () => {
          this.submenu = void 0;
          this.tui.requestRender();
        }
      );
      return;
    }
  }
  currentGenericSettingRawValue(id) {
    return getGenericSettingRawValue(this.config, id);
  }
  async handleGenericSettingChange(id, value) {
    await this.persist((config) => {
      const parsed = GENERIC_SETTING_META[id].parse(value);
      const settings = ensureGenericSettings(config);
      if (parsed === void 0) {
        delete settings[id];
      } else {
        settings[id] = parsed;
      }
      cleanupGenericSettings(config);
      stripGenericPolicyDuplicates(config);
    });
  }
  currentProviderConfigFor(providerId) {
    return this.config.providers?.[providerId];
  }
  async persist(mutate) {
    const nextConfig = structuredClone(this.config);
    try {
      mutate(nextConfig);
      cleanupGenericSettings(nextConfig);
      stripGenericPolicyDuplicates(nextConfig);
      await writeConfigFile(nextConfig);
      if (didContentsCacheInputsChange(this.config, nextConfig)) {
        resetContentStore();
      }
      this.config = nextConfig;
      this.tui.requestRender();
    } catch (error) {
      this.ctx.ui.notify(error.message, "error");
    }
  }
};
var ToolSettingsSubmenu = class {
  constructor(tui, theme, toolId, cwd, getConfig, persist, done) {
    this.tui = tui;
    this.theme = theme;
    this.toolId = toolId;
    this.cwd = cwd;
    this.getConfig = getConfig;
    this.persist = persist;
    this.done = done;
  }
  selection = 0;
  submenu;
  render(width) {
    if (this.submenu) {
      return this.submenu.render(width);
    }
    const entries = this.getEntries();
    const lines = [
      truncateToWidth(
        this.theme.fg("accent", PROVIDER_TOOL_META[this.toolId].label),
        width
      ),
      "",
      ...this.renderEntries(width, entries)
    ];
    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2)
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }
    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg("dim", "\u2191\u2193 move \xB7 Enter edit/toggle \xB7 Esc back"),
        width
      )
    );
    return lines;
  }
  invalidate() {
    this.submenu?.invalidate();
  }
  handleInput(data) {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }
    const kb = getEditorKeybindings();
    const entries = this.getEntries();
    if (kb.matches(data, "selectUp")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "selectDown")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done();
      return;
    }
    this.tui.requestRender();
  }
  getEntries() {
    const config = this.getConfig();
    const mappedProviderId = getMappedProviderIdForCapability(
      config,
      this.toolId
    );
    const enabledProviderIds = getEnabledCompatibleProvidersForTool(
      config,
      this.cwd,
      this.toolId
    );
    const providerValues = [
      "off",
      ...enabledProviderIds.map((providerId) => PROVIDER_MAP[providerId].label)
    ];
    const currentProviderValue = mappedProviderId && enabledProviderIds.includes(mappedProviderId) ? PROVIDER_MAP[mappedProviderId].label : "off";
    const entries = [
      {
        id: "provider",
        label: "Provider",
        currentValue: currentProviderValue,
        description: `Route web_${this.toolId} to one compatible enabled provider or turn it off.`,
        kind: "cycle",
        values: providerValues
      }
    ];
    if (this.toolId === "search") {
      const prefetch = getSearchPrefetchDefaults(config);
      const prefetchProviderIds = getEnabledCompatibleProvidersForTool(
        config,
        this.cwd,
        "contents"
      );
      const prefetchValues = [
        "off",
        ...prefetchProviderIds.map(
          (providerId) => PROVIDER_MAP[providerId].label
        )
      ];
      const currentPrefetchProviderValue = prefetch?.provider && prefetchProviderIds.includes(prefetch.provider) ? PROVIDER_MAP[prefetch.provider].label : "off";
      entries.push(
        {
          id: "prefetchProvider",
          label: "Prefetch",
          currentValue: currentPrefetchProviderValue,
          description: "Optionally start background web_contents extraction after search using a contents-capable provider. Off means no prefetch.",
          kind: "cycle",
          values: prefetchValues
        },
        {
          id: "prefetchMaxUrls",
          label: "Prefetch URLs",
          currentValue: prefetch?.maxUrls !== void 0 ? String(prefetch.maxUrls) : "default",
          description: "Maximum number of search result URLs to prefetch. Leave blank to use the built-in default.",
          kind: "text"
        },
        {
          id: "prefetchTtlMs",
          label: "Prefetch TTL",
          currentValue: prefetch?.ttlMs !== void 0 ? String(prefetch.ttlMs) : "default",
          description: "How long prefetched contents stay reusable in the local cache, in milliseconds. Leave blank to use the built-in default.",
          kind: "text"
        }
      );
    }
    return entries;
  }
  renderEntries(width, entries) {
    const labelWidth = Math.min(
      24,
      Math.max(...entries.map((entry) => entry.label.length), 0)
    );
    return entries.map((entry, index) => {
      const selected = this.selection === index;
      const prefix = selected ? this.theme.fg("accent", "\u2192 ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected ? this.theme.fg("accent", paddedLabel) : paddedLabel;
      const value = selected ? this.theme.fg("accent", entry.currentValue) : this.theme.fg("muted", entry.currentValue);
      return truncateToWidth(`${prefix}${label}  ${value}`, width);
    });
  }
  async activateCurrentEntry() {
    const entry = this.getEntries()[this.selection];
    if (!entry) {
      return;
    }
    if (entry.kind === "cycle" && entry.values && entry.values.length > 0) {
      const currentIndex = entry.values.indexOf(entry.currentValue);
      const nextValue = entry.values[(currentIndex + 1) % entry.values.length];
      await this.handleChange(entry.id, nextValue);
      return;
    }
    if (entry.kind === "text") {
      const currentValue = this.getEntryRawValue(entry.id);
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        currentValue,
        entry.description,
        (selectedValue) => {
          this.submenu = void 0;
          if (selectedValue !== void 0) {
            void this.handleChange(entry.id, selectedValue);
          }
          this.tui.requestRender();
        }
      );
    }
  }
  getEntryRawValue(id) {
    const prefetch = getSearchPrefetchDefaults(this.getConfig());
    switch (id) {
      case "prefetchMaxUrls":
        return prefetch?.maxUrls !== void 0 ? String(prefetch.maxUrls) : "";
      case "prefetchTtlMs":
        return prefetch?.ttlMs !== void 0 ? String(prefetch.ttlMs) : "";
      default:
        return "";
    }
  }
  async handleChange(id, value) {
    await this.persist((config) => {
      switch (id) {
        case "provider":
          config.tools ??= {};
          config.tools[this.toolId] = value === "off" ? null : getEnabledCompatibleProvidersForTool(
            config,
            this.cwd,
            this.toolId
          ).find(
            (providerId) => PROVIDER_MAP[providerId].label === value
          ) ?? null;
          return;
        case "prefetchProvider": {
          const providerId = value === "off" ? null : getEnabledCompatibleProvidersForTool(
            config,
            this.cwd,
            "contents"
          ).find(
            (candidate) => PROVIDER_MAP[candidate].label === value
          ) ?? null;
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch.provider = providerId;
          return;
        }
        case "prefetchMaxUrls":
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch.maxUrls = parseOptionalPositiveIntegerInput(
            value,
            "Prefetch URLs must be a positive integer."
          );
          return;
        case "prefetchTtlMs":
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch.ttlMs = parseOptionalPositiveIntegerInput(
            value,
            "Prefetch TTL must be a positive integer."
          );
          return;
        default:
          throw new Error(`Unknown tool setting '${id}'.`);
      }
    });
  }
};
var ProviderSettingsSubmenu = class {
  constructor(tui, theme, providerId, getProviderConfig, persist, done) {
    this.tui = tui;
    this.theme = theme;
    this.providerId = providerId;
    this.getProviderConfig = getProviderConfig;
    this.persist = persist;
    this.done = done;
  }
  selection = 0;
  submenu;
  render(width) {
    if (this.submenu) {
      return this.submenu.render(width);
    }
    const provider = PROVIDER_MAP[this.providerId];
    const providerConfig = this.getProviderConfig();
    const entries = this.getEntries();
    const lines = [
      truncateToWidth(this.theme.fg("accent", provider.label), width),
      "",
      ...this.renderEntries(width, entries)
    ];
    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2)
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }
    const status = provider.getStatus(providerConfig, "");
    lines.push("");
    lines.push(
      truncateToWidth(this.theme.fg("dim", `Status: ${status.summary}`), width)
    );
    lines.push(
      truncateToWidth(
        this.theme.fg("dim", "\u2191\u2193 move \xB7 Enter edit/toggle \xB7 Esc back"),
        width
      )
    );
    return lines;
  }
  invalidate() {
    this.submenu?.invalidate();
  }
  handleInput(data) {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }
    const kb = getEditorKeybindings();
    const entries = this.getEntries();
    if (kb.matches(data, "selectUp")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "selectDown")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done();
      return;
    }
    this.tui.requestRender();
  }
  getEntries() {
    const providerConfig = this.getProviderConfig();
    return [
      {
        id: "providerEnabled",
        label: "Enabled",
        currentValue: providerConfig?.enabled === true ? "on" : "off",
        description: "Whether this provider is eligible for tool mappings and runtime use.",
        kind: "cycle",
        values: ["on", "off"]
      },
      ...getProviderSettings(this.providerId).map(
        (setting) => this.buildProviderItem(setting, providerConfig)
      )
    ];
  }
  buildProviderItem(setting, providerConfig) {
    if (setting.kind === "values") {
      return {
        id: setting.id,
        label: setting.label,
        currentValue: setting.getValue(providerConfig),
        values: setting.values,
        description: setting.help,
        kind: "cycle"
      };
    }
    const currentValue = setting.getValue(providerConfig);
    return {
      id: setting.id,
      label: setting.label,
      currentValue: summarizeStringValue(currentValue, setting.secret === true),
      description: setting.help,
      kind: "text"
    };
  }
  renderEntries(width, entries) {
    const labelWidth = Math.min(
      24,
      Math.max(...entries.map((entry) => entry.label.length), 0)
    );
    return entries.map((entry, index) => {
      const selected = this.selection === index;
      const prefix = selected ? this.theme.fg("accent", "\u2192 ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected ? this.theme.fg("accent", paddedLabel) : paddedLabel;
      const value = selected ? this.theme.fg("accent", entry.currentValue) : this.theme.fg("muted", entry.currentValue);
      return truncateToWidth(`${prefix}${label}  ${value}`, width);
    });
  }
  async activateCurrentEntry() {
    const entry = this.getEntries()[this.selection];
    if (!entry) return;
    if (entry.kind === "cycle" && entry.values && entry.values.length > 0) {
      const currentIndex = entry.values.indexOf(entry.currentValue);
      const nextValue = entry.values[(currentIndex + 1) % entry.values.length];
      await this.handleChange(entry.id, nextValue);
      return;
    }
    if (entry.kind === "text") {
      const currentValue = this.getEntryRawValue(entry.id) ?? "";
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        currentValue,
        entry.description,
        (selectedValue) => {
          this.submenu = void 0;
          if (selectedValue !== void 0) {
            void this.handleChange(entry.id, selectedValue);
          }
          this.tui.requestRender();
        }
      );
    }
  }
  getEntryRawValue(id) {
    const providerConfig = this.getProviderConfig();
    const setting = getProviderSettings(this.providerId).find(
      (candidate) => candidate.id === id
    );
    if (!setting || setting.kind !== "text") {
      return void 0;
    }
    return setting.getValue(providerConfig);
  }
  async handleChange(id, value) {
    await this.persist((providerConfig) => {
      if (id === "providerEnabled") {
        providerConfig.enabled = value === "on";
        return;
      }
      const setting = getProviderSettings(this.providerId).find(
        (candidate) => candidate.id === id
      );
      if (!setting) {
        throw new Error(`Unknown setting '${id}'.`);
      }
      setting.setValue(providerConfig, value);
    });
  }
};
function ensureSearchToolSettings(config) {
  config.toolSettings ??= {};
  config.toolSettings.search ??= {};
  return config.toolSettings.search;
}
function parseOptionalPositiveIntegerInput(value, errorMessage) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return void 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(errorMessage);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(errorMessage);
  }
  return parsed;
}
function parseOptionalNonNegativeIntegerInput(value, errorMessage) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return void 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(errorMessage);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(errorMessage);
  }
  return parsed;
}
var TextValueSubmenu = class {
  constructor(tui, theme, title, initialValue, help, done) {
    this.theme = theme;
    this.title = title;
    this.help = help;
    this.done = done;
    const editorTheme = {
      borderColor: (text) => this.theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => this.theme.fg("accent", text),
        selectedText: (text) => this.theme.fg("accent", text),
        description: (text) => this.theme.fg("muted", text),
        scrollInfo: (text) => this.theme.fg("dim", text),
        noMatch: (text) => this.theme.fg("warning", text)
      }
    };
    this.editor = new Editor(tui, editorTheme);
    this.editor.setText(initialValue);
    this.editor.onSubmit = (text) => {
      this.done(text.trim());
    };
  }
  editor;
  render(width) {
    return [
      truncateToWidth(this.theme.fg("accent", this.title), width),
      "",
      ...this.editor.render(width),
      "",
      truncateToWidth(this.theme.fg("dim", this.help), width),
      truncateToWidth(
        this.theme.fg(
          "dim",
          "Enter to save \xB7 Shift+Enter for newline \xB7 Esc to cancel"
        ),
        width
      )
    ];
  }
  invalidate() {
    this.editor.invalidate();
  }
  handleInput(data) {
    if (matchesKey(data, Key.escape)) {
      this.done(void 0);
      return;
    }
    this.editor.handleInput(data);
  }
};
function getEditableProviderConfig(providerId, current) {
  return structuredClone(
    current ?? PROVIDER_MAP[providerId].createTemplate()
  );
}
function getInitialProviderSelection(config) {
  for (const capability of Object.keys(
    CAPABILITY_TOOL_NAMES
  )) {
    const providerId = getMappedProviderIdForCapability(config, capability);
    if (providerId) {
      return providerId;
    }
  }
  return "codex";
}
function didContentsCacheInputsChange(previous, next) {
  return stableStringify2(getContentsCacheInputs(previous)) !== stableStringify2(getContentsCacheInputs(next));
}
function getContentsCacheInputs(config) {
  const providers = {};
  for (const provider of PROVIDERS) {
    if (!supportsProviderCapability(provider, "contents")) {
      continue;
    }
    providers[provider.id] = config.providers?.[provider.id] ?? null;
  }
  return { providers };
}
function stableStringify2(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify2(item)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableStringify2(
      value[key]
    )}`
  ).join(",")}}`;
}
function summarizeStringValue(value, secret) {
  if (!value) return "unset";
  if (secret) {
    if (value.startsWith("!")) return "!command";
    if (/^[A-Z][A-Z0-9_]*$/.test(value)) return `env:${value}`;
    return "literal";
  }
  return truncateInline(value, 40);
}
function isJsonObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clampResults(value) {
  if (value === void 0) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_ALLOWED_RESULTS);
}
function resolveSearchQueries(queries) {
  if (queries.length === 0) {
    throw new Error("queries must contain at least one item.");
  }
  return queries.map(
    (value, index) => normalizeSearchQuery(value, `queries[${index}]`)
  );
}
function resolveAnswerQueries(queries) {
  if (queries.length === 0) {
    throw new Error("queries must contain at least one item.");
  }
  return queries.map(
    (value, index) => normalizeSearchQuery(value, `queries[${index}]`)
  );
}
function normalizeSearchQuery(value, fieldName) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}
function getSearchQueriesForDisplay(queries) {
  if (!Array.isArray(queries)) {
    return [];
  }
  return queries.map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value.length > 0);
}
function getAnswerQueriesForDisplay(queries) {
  return getSearchQueriesForDisplay(queries);
}
function createBatchProgressReporter(report, queries, index) {
  if (!report) {
    return void 0;
  }
  if (queries.length <= 1) {
    return report;
  }
  const label = `${index + 1}/${queries.length}`;
  return (message) => {
    report(`${message} (${label})`);
  };
}
function buildWebSearchDetails(provider, outcomes) {
  return {
    tool: "web_search",
    provider,
    queryCount: outcomes.length,
    failedQueryCount: outcomes.filter((outcome) => outcome.error !== void 0).length,
    resultCount: outcomes.reduce(
      (count, outcome) => count + (outcome.response?.results.length ?? 0),
      0
    )
  };
}
function extractTextContent(content) {
  if (!content || content.length === 0) {
    return void 0;
  }
  const text = content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text?.trimEnd() ?? "").join("\n").trim();
  return text.length > 0 ? text : void 0;
}
function renderCallHeader(params, theme) {
  const maxResultsSuffix = params.maxResults !== void 0 && params.maxResults !== DEFAULT_MAX_RESULTS ? ` (max ${params.maxResults})` : void 0;
  return renderListCallHeader(
    "web_search",
    getSearchQueriesForDisplay(params.queries),
    theme,
    {
      singleItemFormatter: (query2) => formatQuotedPreview(query2),
      suffix: maxResultsSuffix
    }
  );
}
function renderMarkdownBlock(text) {
  if (!text) {
    return new Text("", 0, 0);
  }
  return new Markdown(`
${text}`, 0, 0, getMarkdownTheme());
}
function renderBlockText(text, theme, color) {
  if (!text) {
    return new Text("", 0, 0);
  }
  const rendered = text.split("\n").map((line) => theme.fg(color, line)).join("\n");
  return new Text(`
${rendered}`, 0, 0);
}
function renderSimpleText(text, theme, color) {
  return new Text(theme.fg(color, text), 0, 0);
}
function renderCollapsedSearchSummary(details, _text, theme) {
  const providerLabel = PROVIDER_MAP[details.provider]?.label ?? details.provider;
  const count = `${details.resultCount} result${details.resultCount === 1 ? "" : "s"}`;
  const failureSuffix = details.failedQueryCount > 0 ? `, ${details.failedQueryCount} failed` : "";
  const base = details.queryCount > 1 ? `${details.queryCount} queries, ${count} via ${providerLabel}${failureSuffix}` : `${count} via ${providerLabel}${failureSuffix}`;
  let summary = theme.fg("success", base);
  summary += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summary, 0, 0);
}
function appendProviderSummary(summary, provider) {
  const providerLabel = PROVIDER_MAP[provider]?.label ?? provider;
  const providerSuffix = `via ${providerLabel}`;
  return summary.toLowerCase().includes(providerSuffix.toLowerCase()) ? summary : `${summary} ${providerSuffix}`;
}
function getFirstLine(text) {
  if (!text) {
    return void 0;
  }
  const firstLine = text.split("\n", 1)[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : void 0;
}
function getExpandHint() {
  try {
    return keyHint("expandTools", "to expand");
  } catch {
    return "to expand";
  }
}
function cleanSingleLine(text) {
  return text.replace(/\s+/g, " ").trim();
}
function formatQuotedPreview(text, maxLength = 80) {
  return `"${truncateInline(cleanSingleLine(text), maxLength)}"`;
}
function formatSearchResponses(outcomes, prefetch) {
  const body = outcomes.map(
    (outcome, index) => formatSearchOutcomeSection(outcome, index, outcomes.length)
  ).join("\n\n");
  if (!prefetch) {
    return body;
  }
  return `${body}

---

Background contents prefetch started via ${prefetch.provider} for ${prefetch.urlCount} URL(s). Prefetch id: ${prefetch.prefetchId}`;
}
function formatSearchOutcomeSection(outcome, index, total) {
  const heading = total > 1 ? `## Query ${index + 1}: ${formatSearchHeading(outcome.query)}` : `## ${formatSearchHeading(outcome.query)}`;
  const body = outcome.response ? formatSearchResponseMarkdown(outcome.response) : `Search failed: ${outcome.error ?? "Unknown error."}`;
  return `${heading}

${body}`;
}
function formatSearchHeading(query2) {
  return `"${escapeMarkdownText(cleanSingleLine(query2))}"`;
}
function formatAnswerHeading(query2) {
  return `"${escapeMarkdownText(cleanSingleLine(query2))}"`;
}
function collectSearchResultUrls(outcomes) {
  return outcomes.flatMap(
    (outcome) => outcome.response?.results.map((result) => result.url) ?? []
  );
}
function formatSearchResponseMarkdown(response) {
  if (response.results.length === 0) {
    return "No results found.";
  }
  return response.results.map((result, index) => {
    const lines = [
      `${index + 1}. ${formatMarkdownLink(result.title, result.url)}`
    ];
    if (result.snippet) {
      lines.push(`   ${escapeMarkdownText(cleanSingleLine(result.snippet))}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}
function formatMarkdownLink(label, url) {
  return `[${escapeMarkdownLinkLabel(label)}](<${url}>)`;
}
function escapeMarkdownLinkLabel(text) {
  return cleanSingleLine(text).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}
function escapeMarkdownText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("_", "\\_").replaceAll("`", "\\`").replaceAll("#", "\\#").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
async function truncateAndSave(text, prefix) {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES
  });
  if (!truncation.truncated) return truncation.content;
  const dir = join4(tmpdir(), `pi-web-providers-${prefix}-${Date.now()}`);
  await mkdir2(dir, { recursive: true });
  const fullPath = join4(dir, "output.txt");
  await writeFile2(fullPath, text, "utf-8");
  return truncation.content + `

[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullPath}]`;
}
function truncateInline(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}\u2026`;
}
var __test__ = {
  didContentsCacheInputsChange,
  executeAnswerTool,
  executeProviderTool,
  executeSearchTool,
  extractTextContent,
  getAvailableManagedToolNames,
  getEnabledCompatibleProvidersForTool,
  describeOptionsField,
  getAvailableProviderIdsForCapability,
  getSyncedActiveTools,
  renderCallHeader,
  renderQuestionCallHeader,
  renderResearchCallHeader,
  renderToolCallHeader,
  renderCollapsedSearchSummary,
  renderCollapsedProviderToolSummary,
  renderSearchToolResult,
  renderProviderToolResult,
  formatSearchResponses,
  formatAnswerResponses
};
export {
  __test__,
  webProvidersExtension as default
};
