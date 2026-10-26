import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

const { POST } = await import("@/app/api/internal/revalidate/route");

const SECRET = "s".repeat(40);
const call = (body: unknown, auth?: string) =>
  POST(
    new Request("https://example.test/api/internal/revalidate", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/internal/revalidate", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
  });

  it("rejects a missing or wrong secret", async () => {
    expect((await call({ slug: "lemon-bars" })).status).toBe(401);
    expect((await call({ slug: "lemon-bars" }, "Bearer wrong")).status).toBe(401);
    expect((await call({ slug: "lemon-bars" }, `Bearer ${SECRET}x`)).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("is disabled when the secret is unset or too short", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");
    expect((await call({}, "Bearer ")).status).toBe(401);
    vi.stubEnv("REVALIDATE_SECRET", "short");
    expect((await call({}, "Bearer short")).status).toBe(401);
  });

  it("expires the recipe list and the recipe page", async () => {
    const res = await call({ slug: "lemon-bars" }, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("recipes", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("recipe:lemon-bars", { expire: 0 });
  });

  it("rejects an invalid slug", async () => {
    expect((await call({ slug: "../etc" }, `Bearer ${SECRET}`)).status).toBe(400);
    expect((await call("not json", `Bearer ${SECRET}`)).status).toBe(400);
  });
});
