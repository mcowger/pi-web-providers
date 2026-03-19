import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  CustomCliProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { CustomCliProvider } from "./custom-cli.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { ParallelProvider } from "./parallel.js";
import { PerplexityProvider } from "./perplexity.js";
import { ValyuProvider } from "./valyu.js";

const claudeProvider = new ClaudeProvider();
const codexProvider = new CodexProvider();
const exaProvider = new ExaProvider();
const geminiProvider = new GeminiProvider();
const perplexityProvider = new PerplexityProvider();
const parallelProvider = new ParallelProvider();
const valyuProvider = new ValyuProvider();
const customCliProvider = new CustomCliProvider();

export const PROVIDERS: ReadonlyArray<
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | CustomCliProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = [
  claudeProvider,
  codexProvider,
  exaProvider,
  geminiProvider,
  perplexityProvider,
  parallelProvider,
  valyuProvider,
  customCliProvider,
];

export const PROVIDER_MAP: Record<
  ProviderId,
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | CustomCliProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = {
  claude: claudeProvider,
  codex: codexProvider,
  "custom-cli": customCliProvider,
  exa: exaProvider,
  gemini: geminiProvider,
  perplexity: perplexityProvider,
  parallel: parallelProvider,
  valyu: valyuProvider,
};
