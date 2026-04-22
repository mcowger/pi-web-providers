import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaAdapter } from "../src/providers/ollama.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.OLLAMA_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ollamaAdapter", () => {
  it("returns search results from the Ollama web search API", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Ollama",
              url: "https://ollama.com/",
              content: "Cloud models are now available in Ollama",
            },
            {
              title: "What is Ollama?",
              url: "https://example.com/what-is-ollama",
              content: "Ollama is an open-source tool...",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await ollamaAdapter.search(
      "what is ollama?",
      5,
      {
        apiKey: "OLLAMA_API_KEY",
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama.com/api/web_search",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "what is ollama?", max_results: 5 }),
      }),
    );

    expect(response.provider).toBe("ollama");
    expect(response.results).toEqual([
      {
        title: "Ollama",
        url: "https://ollama.com/",
        snippet: "Cloud models are now available in Ollama",
      },
      {
        title: "What is Ollama?",
        url: "https://example.com/what-is-ollama",
        snippet: "Ollama is an open-source tool...",
      },
    ]);
  });

  it("clamps max_results to 1–10 range", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await ollamaAdapter.search("test", 20, {
      apiKey: "OLLAMA_API_KEY",
    }, { cwd: process.cwd() });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ query: "test", max_results: 10 }),
      }),
    );
  });

  it("returns contents from the Ollama web fetch API", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Ollama",
          content: "Cloud models are now available in Ollama",
          links: ["https://ollama.com/models"],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await ollamaAdapter.contents(
      ["https://ollama.com"],
      {
        apiKey: "OLLAMA_API_KEY",
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama.com/api/web_fetch",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://ollama.com" }),
      }),
    );

    expect(response.provider).toBe("ollama");
    expect(response.answers).toHaveLength(1);
    expect(response.answers[0].url).toBe("https://ollama.com");
    expect(response.answers[0].content).toContain(
      "Cloud models are now available",
    );
  });

  it("handles failed fetch requests gracefully in contents", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 403, statusText: "Forbidden" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await ollamaAdapter.contents(
      ["https://ollama.com"],
      {
        apiKey: "OLLAMA_API_KEY",
      },
      { cwd: process.cwd() },
    );

    expect(response.provider).toBe("ollama");
    expect(response.answers).toHaveLength(1);
    expect(response.answers[0].error).toContain("Ollama fetch failed");
  });

  it("surfaces Ollama HTTP errors with response details", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    ) as typeof fetch;

    await expect(
      ollamaAdapter.search(
        "test",
        5,
        {
          apiKey: "OLLAMA_API_KEY",
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(
      /Ollama API request failed \(401 Unauthorized\): invalid key/,
    );
  });

  it("requires an API key", async () => {
    await expect(
      ollamaAdapter.search(
        "test",
        5,
        {
          apiKey: "OLLAMA_API_KEY",
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });

  it("reports not available when apiKey is missing", () => {
    const status = ollamaAdapter.getCapabilityStatus({
      apiKey: "OLLAMA_API_KEY",
    });
    expect(status).toEqual({ state: "missing_api_key" });
  });

  it("reports ready when apiKey resolves", () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const status = ollamaAdapter.getCapabilityStatus({
      apiKey: "OLLAMA_API_KEY",
    });
    expect(status).toEqual({ state: "ready" });
  });

  it("supports search and contents tools", () => {
    expect(ollamaAdapter.tools).toEqual(["search", "contents"]);
  });
});
