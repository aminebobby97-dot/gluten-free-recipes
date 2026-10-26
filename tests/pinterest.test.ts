import { describe, expect, it } from "vitest";
import { buildPinDraft, getPinterestPublisher } from "@/lib/services/pinterest";
import { ServiceError } from "@/lib/services/errors";
import { pinterestSaveUrl } from "@/lib/pinterest";

const recipe = {
  id: "abc",
  slug: "gluten-free-brownies",
  title: "Gluten-Free Chocolate Brownies",
  description: "d".repeat(600),
  pinterest_image: null,
  featured_image: "https://cdn.example.test/brownies.jpg",
  focus_keyword: "gluten-free brownies",
};

describe("buildPinDraft", () => {
  it("links to the recipe and respects Pinterest limits", () => {
    const pin = buildPinDraft(recipe, "https://www.example.com/");
    expect(pin.destination_url).toBe("https://www.example.com/recipes/gluten-free-brownies");
    expect(pin.image_url).toBe(recipe.featured_image);
    expect(pin.pin_description.length).toBeLessThanOrEqual(500);
    expect(pin.idempotency_key).toBe("pin:abc:primary");
  });

  it("prefers the dedicated Pinterest image", () => {
    expect(buildPinDraft({ ...recipe, pinterest_image: "https://cdn.example.test/pin.jpg" }, "https://www.example.com").image_url).toBe("https://cdn.example.test/pin.jpg");
  });

  it("requires an image and an https site", () => {
    expect(() => buildPinDraft({ ...recipe, featured_image: null }, "https://www.example.com")).toThrow(ServiceError);
    expect(() => buildPinDraft(recipe, "http://localhost:3000")).toThrow(/https/);
  });
});

describe("Pinterest publishing", () => {
  it("is disabled in Phase 1", () => {
    expect(() => getPinterestPublisher()).toThrow(/not enabled/);
  });

  it("builds a Save link without posting anything", () => {
    const url = new URL(pinterestSaveUrl({ url: "https://x.test/r", media: "https://x.test/i.jpg", description: "Brownies & more" }));
    expect(url.hostname).toBe("www.pinterest.com");
    expect(url.searchParams.get("description")).toBe("Brownies & more");
  });
});
