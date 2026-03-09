import { afterEach, describe, expect, it } from "vitest";
import {
  resolveProviderChoice,
  resolveProviderForCapability,
} from "../src/provider-resolution.js";
import type { WebProvidersConfig } from "../src/types.js";

afterEach(() => {
  delete process.env.EXA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.VALYU_API_KEY;
});

describe("provider resolution", () => {
  it("uses the explicit provider when it is configured", () => {
    process.env.EXA_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, "exa", process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("prefers explicitly enabled providers in alphabetical order", () => {
    process.env.EXA_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
        },
        gemini: {
          enabled: true,
          apiKey: "GOOGLE_API_KEY",
        },
        valyu: {
          enabled: true,
          apiKey: "VALYU_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, undefined, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("falls back to the first available provider alphabetically when none are explicitly enabled", () => {
    process.env.EXA_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          apiKey: "EXA_API_KEY",
        },
        gemini: {
          apiKey: "GOOGLE_API_KEY",
        },
        valyu: {
          apiKey: "VALYU_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, undefined, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("skips providers that have the requested tool disabled", () => {
    process.env.EXA_API_KEY = "test-key";
    process.env.PARALLEL_API_KEY = "test-key";
    process.env.VALYU_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          tools: {
            contents: false,
          },
        },
        parallel: {
          enabled: true,
          apiKey: "PARALLEL_API_KEY",
          tools: {
            contents: true,
          },
        },
        valyu: {
          enabled: true,
          apiKey: "VALYU_API_KEY",
          tools: {
            contents: true,
          },
        },
      },
    };

    const provider = resolveProviderForCapability(
      config,
      undefined,
      process.cwd(),
      "contents",
    );
    expect(provider.id).toBe("parallel");
  });
});
