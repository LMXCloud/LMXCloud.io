import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicHttpsUrl,
  isPrivateAddress,
  safeFetchBytes,
  UnsafeUrlError,
  type HostResolver,
} from "./safe-fetch.js";

const resolverFor =
  (table: Record<string, string[]>): HostResolver =>
  async (host) => {
    const hit = table[host];
    if (!hit) throw new Error("ENOTFOUND");
    return hit;
  };

const publicResolver = resolverFor({
  "files.example.org": ["93.184.215.14"],
  "evil.example.org": ["93.184.215.15"],
  "rebind.example.org": ["10.0.0.5"],
  "mixed.example.org": ["93.184.215.16", "127.0.0.1"],
});

function stubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const key = input instanceof Request ? input.url : String(input);
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch ${key}`);
    return route();
  }) as typeof fetch;
}

describe("isPrivateAddress", () => {
  it("flags private, loopback, link-local and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.193",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });
});

describe("assertPublicHttpsUrl", () => {
  it("accepts https on a public host", async () => {
    const url = await assertPublicHttpsUrl("https://files.example.org/a.pdf", publicResolver);
    assert.equal(url.hostname, "files.example.org");
  });

  it("rejects http, credentials, internal names and private literals", async () => {
    for (const raw of [
      "http://files.example.org/a.pdf",
      "https://user:pw@files.example.org/a.pdf",
      "https://localhost/a.pdf",
      "https://api.railway.internal/a.pdf",
      "https://127.0.0.1/a.pdf",
      "https://[::1]/a.pdf",
      "https://169.254.169.254/latest/meta-data",
      "https://rebind.example.org/a.pdf",
      "https://mixed.example.org/a.pdf",
      "https://does-not-resolve.example.org/a.pdf",
      "not a url",
    ]) {
      await assert.rejects(assertPublicHttpsUrl(raw, publicResolver), UnsafeUrlError, raw);
    }
  });
});

describe("safeFetchBytes", () => {
  it("returns the body for a public URL", async () => {
    const bytes = await safeFetchBytes("https://files.example.org/a.pdf", {
      resolve: publicResolver,
      fetchImpl: stubFetch({
        "https://files.example.org/a.pdf": () => new Response("%PDF-1.4 hello"),
      }),
    });
    assert.equal(Buffer.from(bytes).toString(), "%PDF-1.4 hello");
  });

  it("refuses a redirect to a private address", async () => {
    await assert.rejects(
      safeFetchBytes("https://evil.example.org/start", {
        resolve: publicResolver,
        fetchImpl: stubFetch({
          "https://evil.example.org/start": () =>
            new Response(null, { status: 302, headers: { location: "https://10.0.0.8/secret" } }),
        }),
      }),
      UnsafeUrlError,
    );
  });

  it("refuses a redirect that downgrades to http", async () => {
    await assert.rejects(
      safeFetchBytes("https://evil.example.org/start", {
        resolve: publicResolver,
        fetchImpl: stubFetch({
          "https://evil.example.org/start": () =>
            new Response(null, {
              status: 301,
              headers: { location: "http://tools.railway.internal:8080/admin" },
            }),
        }),
      }),
      UnsafeUrlError,
    );
  });

  it("follows a safe redirect to another public host", async () => {
    const bytes = await safeFetchBytes("https://evil.example.org/start", {
      resolve: publicResolver,
      fetchImpl: stubFetch({
        "https://evil.example.org/start": () =>
          new Response(null, { status: 302, headers: { location: "https://files.example.org/a.pdf" } }),
        "https://files.example.org/a.pdf": () => new Response("%PDF ok"),
      }),
    });
    assert.equal(Buffer.from(bytes).toString(), "%PDF ok");
  });

  it("stops after too many redirects", async () => {
    await assert.rejects(
      safeFetchBytes("https://evil.example.org/loop", {
        resolve: publicResolver,
        maxRedirects: 2,
        fetchImpl: stubFetch({
          "https://evil.example.org/loop": () =>
            new Response(null, { status: 302, headers: { location: "https://evil.example.org/loop" } }),
        }),
      }),
      /redirected too many times/,
    );
  });

  it("caps the download size", async () => {
    await assert.rejects(
      safeFetchBytes("https://files.example.org/big.pdf", {
        resolve: publicResolver,
        maxBytes: 10,
        fetchImpl: stubFetch({
          "https://files.example.org/big.pdf": () => new Response("x".repeat(100)),
        }),
      }),
      /too large/,
    );
  });

  it("does not echo upstream error text", async () => {
    await assert.rejects(
      safeFetchBytes("https://files.example.org/missing.pdf", {
        resolve: publicResolver,
        fetchImpl: stubFetch({
          "https://files.example.org/missing.pdf": () =>
            new Response("internal stack trace", { status: 403, statusText: "Forbidden by internal-host-7" }),
        }),
      }),
      (error: Error) => error.message === "Could not fetch file_url (HTTP 403).",
    );
  });
});
