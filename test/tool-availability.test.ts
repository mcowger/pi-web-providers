import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __test__ } from "../src/index.js";
import type { WebProvidersConfig } from "../src/types.js";

const originalHome = process.env.HOME;
const cleanupDirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-providers-home-"));
  cleanupDirs.push(home);
  process.env.HOME = home;
});

afterEach(() => {
  delete process.env.EXA_API_KEY;
  delete process.env.CODEX_API_KEY;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("managed tool availability", () => {
  it("only exposes available provider overrides to the model", () => {
    process.env.CODEX_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: true,
        },
        exa: {
          enabled: false,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["codex"]);
  });

  it("keeps web_search available via implicit Codex fallback", () => {
    process.env.CODEX_API_KEY = "test-key";

    const config: WebProvidersConfig = { version: 1 };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search"]);
  });

  it("hides managed tools when no provider is available", () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: false,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("hides the implicit Codex fallback when Codex auth is missing", () => {
    const config: WebProvidersConfig = { version: 1 };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("respects provider tool capability toggles", () => {
    process.env.EXA_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          tools: {
            search: false,
            contents: true,
            answer: false,
            research: true,
          },
        },
      },
    };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_contents", "web_research"]);
  });
});
