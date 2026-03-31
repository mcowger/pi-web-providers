import { describe, expect, it } from "vitest";
import { buildProviderPlan } from "../src/providers/framework.js";

describe("provider framework", () => {
  it("builds provider plans with inherited settings", () => {
    const plan = buildProviderPlan({
      request: {
        capability: "search",
        query: "latest docs",
        maxResults: 3,
      },
      config: {
        settings: {
          requestTimeoutMs: 1000,
          retryCount: 2,
        },
      },
      providerId: "exa",
      providerLabel: "Exa",
      handlers: {
        search: {
          execute: async () => ({
            provider: "exa",
            results: [],
          }),
        },
      },
    });

    expect(plan).toMatchObject({
      capability: "search",
      traits: {
        settings: {
          requestTimeoutMs: 1000,
          retryCount: 2,
        },
      },
    });
  });

  it("builds research plans like any other provider plan", async () => {
    const plan = buildProviderPlan({
      request: {
        capability: "research",
        input: "Investigate",
      },
      config: {
        settings: {
          requestTimeoutMs: 5000,
        },
      },
      providerId: "gemini",
      providerLabel: "Gemini",
      handlers: {
        research: {
          execute: async () => ({
            provider: "gemini",
            text: "done",
          }),
        },
      },
    });

    expect(plan).toMatchObject({
      capability: "research",
      traits: {
        settings: {
          requestTimeoutMs: 5000,
        },
      },
    });
    await expect(plan?.execute({ cwd: process.cwd() })).resolves.toEqual({
      provider: "gemini",
      text: "done",
    });
  });
});
