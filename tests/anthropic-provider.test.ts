import { describe, expect, it } from "vitest";
import { ClaudeOutputError, createAnthropicProviders, replyCostUsd, type ClaudeClient, type ClaudeReply } from "@/lib/automation/providers/anthropic";
import { RECIPE_JSON_SCHEMA, REVIEW_JSON_SCHEMA, PHOTO_CHECK_JSON_SCHEMA } from "@/lib/automation/providers/prompts";
import { AiCallError } from "@/lib/automation/types";
import { CATEGORY, goodRecipe } from "./support/automation-fixtures";

function reply(json: unknown, over: Partial<ClaudeReply> = {}): ClaudeReply {
  return {
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "thinking" }, { type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
    usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  };
}

function fakeClient(replies: ClaudeReply[]) {
  const requests: Array<Record<string, unknown>> = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        stream: (params) => {
          requests.push(params as unknown as Record<string, unknown>);
          const next = replies.shift();
          if (!next) throw new Error("no reply queued");
          return { finalMessage: async () => next };
        },
      },
    },
  };
  return { client, requests };
}

const keyword = { id: "kw-1", keyword: "gluten free blueberry muffins", category_id: null, search_volume: null, keyword_difficulty: null };
const writerInput = { keyword, categories: [CATEGORY], existingTitles: ["Gluten-Free Banana Bread"] };

describe("Claude providers", () => {
  it("asks the writer for schema JSON with fallbacks and returns it with its cost", async () => {
    const { client, requests } = fakeClient([reply(goodRecipe())]);
    const { writer } = createAnthropicProviders({ client });
    const result = await writer.run(writerInput);

    expect(result.output).toEqual(goodRecipe());
    expect(result).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", promptVersion: "recipe-v2", inputTokens: 1000, outputTokens: 2000 });
    // 1,000 input at $4/M + 2,000 output at $20/M
    expect(result.costUsd).toBeCloseTo(0.044, 6);

    const req = requests[0] as { output_config: { format: { schema: unknown } }; betas: string[]; fallbacks: string; messages: Array<{ content: Array<{ text: string }> }> };
    expect(req.output_config.format.schema).toBe(RECIPE_JSON_SCHEMA);
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.fallbacks).toBe("default");
    const prompt = req.messages[0].content[0].text;
    expect(prompt).toContain("gluten free blueberry muffins");
    expect(prompt).toContain("gluten-free-baking");
    expect(prompt).toContain("Gluten-Free Banana Bread");
  });

  it("sends the draft and its issues to the repairer", async () => {
    const { client, requests } = fakeClient([reply(goodRecipe())]);
    const { repairer } = createAnthropicProviders({ client });
    await repairer.run({ ...writerInput, draft: goodRecipe(), issues: [{ severity: "blocking", source: "seo", field: "seo_title", message: "Too long." }] });
    const prompt = (requests[0] as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text;
    expect(prompt).toContain("[blocking] seo_title: Too long.");
    expect(prompt).toContain('"slug": "gluten-free-blueberry-muffins"');
  });

  it("returns the reviewer's issues and rejects a malformed verdict", async () => {
    const issues = [{ severity: "blocking", field: "ingredients[2]", message: "Baking powder needs a gluten-free label." }];
    const { client, requests } = fakeClient([reply({ issues }), reply({ verdict: "fine" })]);
    const { reviewer } = createAnthropicProviders({ client });

    expect((await reviewer.run(goodRecipe())).output.issues).toEqual(issues);
    expect((requests[0] as { output_config: { format: { schema: unknown } } }).output_config.format.schema).toBe(REVIEW_JSON_SCHEMA);
    // The reviewer never sees the writer's photo brief, only the recipe.
    expect(JSON.stringify(requests[0])).not.toContain("image_brief");

    await expect(reviewer.run(goodRecipe())).rejects.toThrow(/unexpected shape/);
  });

  it("sends the photo to the checker as a base64 image", async () => {
    const { client, requests } = fakeClient([reply({ ok: false, problems: ["Shows a bagel."] })]);
    const { photoChecker } = createAnthropicProviders({ client });
    const result = await photoChecker.run({ recipe: goodRecipe(), photo: { data: new Uint8Array([1, 2, 3]), mimeType: "image/webp" } });

    expect(result.output).toEqual({ ok: false, problems: ["Shows a bagel."] });
    const req = requests[0] as { output_config: { format: { schema: unknown } }; messages: Array<{ content: Array<{ type: string; source?: { data: string; media_type: string } }> }> };
    expect(req.output_config.format.schema).toBe(PHOTO_CHECK_JSON_SCHEMA);
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/webp", data: "AQID" } });
  });

  it("throws a billed error when Claude declines, is cut off or returns broken JSON", async () => {
    const { client } = fakeClient([reply("", { stop_reason: "refusal" }), reply("{", { stop_reason: "max_tokens" }), reply("not json")]);
    const { writer } = createAnthropicProviders({ client });

    for (const pattern of [/declined/, /cut off/, /not valid JSON/]) {
      const error = await writer.run(writerInput).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ClaudeOutputError);
      expect(error).toBeInstanceOf(AiCallError);
      expect((error as Error).message).toMatch(pattern);
      expect((error as AiCallError).costUsd).toBeGreaterThan(0);
    }
  });

  it("prices each iteration at its own model's rates, and unknown models at the highest rate", () => {
    const usage = { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const fallback = reply({}, {
      model: "claude-opus-4-8",
      usage: {
        ...usage,
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 0 },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 1000 },
        ],
      },
    });
    // $0.004 for the declined attempt + $0.005 + $0.025 for the fallback
    expect(replyCostUsd(fallback, "claude-opus-5-5")).toBeCloseTo(0.034, 6);

    const unknown = reply({}, { model: "claude-future-9", usage });
    // Priced as claude-opus-4-8: $0.01 + $0.025
    expect(replyCostUsd(unknown, "claude-opus-5-5")).toBeCloseTo(0.035, 6);
  });

  it("estimates a worst case that covers a fallback model", () => {
    const { writer, reviewer } = createAnthropicProviders({ client: fakeClient([]).client });
    // 24,000 output tokens at the fallback's $25/M is $0.60 before input.
    expect(writer.estimateUsd(writerInput)).toBeGreaterThan(0.6);
    expect(writer.estimateUsd(writerInput)).toBeLessThan(0.7);
    expect(reviewer.estimateUsd(goodRecipe())).toBeGreaterThan(0.3);
  });

  it("refuses a model with no configured price", () => {
    expect(() => createAnthropicProviders({ client: fakeClient([]).client, model: "claude-unknown" })).toThrow(/No price/);
  });
});
