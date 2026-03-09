import type { ProviderId, WebProvider } from "../types.js";
import type {
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  ValyuProviderConfig,
} from "../types.js";
import { CodexProvider } from "./codex.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { ParallelProvider } from "./parallel.js";
import { ValyuProvider } from "./valyu.js";

export const PROVIDERS: ReadonlyArray<
  WebProvider<
    | CodexProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = [
  new CodexProvider(),
  new ExaProvider(),
  new GeminiProvider(),
  new ParallelProvider(),
  new ValyuProvider(),
];

export const PROVIDER_MAP: Record<
  ProviderId,
  WebProvider<
    | CodexProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = {
  codex: PROVIDERS[0],
  exa: PROVIDERS[1],
  gemini: PROVIDERS[2],
  parallel: PROVIDERS[3],
  valyu: PROVIDERS[4],
};
