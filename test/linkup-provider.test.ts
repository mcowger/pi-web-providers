import { afterEach, describe, expect, it, vi } from "vitest";

const { linkupCtorMock, linkupFetchMock, linkupSearchMock } = vi.hoisted(
  () => ({
    linkupCtorMock: vi.fn(),
    linkupFetchMock: vi.fn(),
    linkupSearchMock: vi.fn(),
  }),
);

vi.mock("linkup-sdk", () => ({
  LinkupClient: linkupCtorMock.mockImplementation(function MockLinkup() {
    return {
      search: linkupSearchMock,
      fetch: linkupFetchMock,
    };
  }),
}));

import { linkupAdapter } from "../src/providers/linkup.js";

afterEach(() => {
  delete process.env.LINKUP_API_KEY;
  linkupCtorMock.mockClear();
  linkupSearchMock.mockReset();
  linkupFetchMock.mockReset();
});

describe("linkupAdapter", () => {
  it("uses Linkup search with fixed standard search-results mode", async () => {
    process.env.LINKUP_API_KEY = "test-key";

    linkupSearchMock.mockResolvedValue({
      results: [
        {
          type: "text",
          name: "Linkup Docs",
          url: "https://docs.linkup.so",
          content: "Official documentation for Linkup.",
          favicon: "https://docs.linkup.so/favicon.ico",
        },
        {
          type: "image",
          name: "Linkup logo",
          url: "https://example.com/logo.png",
        },
      ],
    });

    const response = await linkupAdapter.search(
      "linkup sdk",
      2,
      {
        apiKey: "LINKUP_API_KEY",
        baseUrl: "https://api.linkup.test/v1",
      },
      { cwd: process.cwd() },
      {
        depth: "deep",
        outputType: "structured",
      },
    );

    expect(linkupCtorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseUrl: "https://api.linkup.test/v1",
    });
    expect(linkupSearchMock).toHaveBeenCalledWith({
      query: "linkup sdk",
      depth: "standard",
      outputType: "searchResults",
      maxResults: 2,
    });
    expect(response).toEqual({
      provider: "linkup",
      results: [
        {
          title: "Linkup Docs",
          url: "https://docs.linkup.so",
          snippet: "Official documentation for Linkup.",
          metadata: {
            type: "text",
            favicon: "https://docs.linkup.so/favicon.ico",
          },
        },
        {
          title: "Linkup logo",
          url: "https://example.com/logo.png",
          snippet: "",
          metadata: {
            type: "image",
          },
        },
      ],
    });
  });

  it("fetches markdown contents per URL and preserves URL order", async () => {
    linkupFetchMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url === "https://example.com/a") {
        return {
          markdown: "# Page A\n\nBody A",
        };
      }
      if (url === "https://example.com/b") {
        throw new Error("blocked by robots");
      }
      return {
        markdown: "",
      };
    });

    const response = await linkupAdapter.contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      {
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
      {
        renderJs: true,
      },
    );

    expect(linkupCtorMock).toHaveBeenCalledWith({
      apiKey: "literal-key",
      baseUrl: undefined,
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(1, {
      url: "https://example.com/a",
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(2, {
      url: "https://example.com/b",
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(3, {
      url: "https://example.com/c",
    });
    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "# Page A\n\nBody A",
      },
      {
        url: "https://example.com/b",
        error: "blocked by robots",
      },
      {
        url: "https://example.com/c",
        error: "No content returned for this URL.",
      },
    ]);
  });

  it("requires an API key", async () => {
    await expect(
      linkupAdapter.search(
        "linkup",
        1,
        {
          apiKey: "LINKUP_API_KEY",
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });
});
