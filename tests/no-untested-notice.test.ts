import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The "Not yet kitchen-tested" notice was removed from recipe pages. This keeps it
// from coming back in any page, component or AI prompt.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|md)$/.test(name) ? [path] : [];
  });
}

describe("recipe testing notice", () => {
  it("is not shown anywhere in the site or the generation prompts", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).filter((file) =>
      /not yet kitchen-tested/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
