import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** vendor/ holds outside repos for reference only: app code must never import or run them. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs|js)$/.test(p) ? [p] : [];
  });
}

describe("vendor isolation", () => {
  it("no app code, script or test imports from vendor/", () => {
    const offenders = ["src", "scripts", "tests"].flatMap(files).filter((f) => {
      const text = readFileSync(f, "utf8");
      return /from\s+["'][^"']*vendor\/|require\(\s*["'][^"']*vendor\/|import\(\s*["'][^"']*vendor\//.test(text);
    });
    expect(offenders).toEqual([]);
  });
  it("vendor is excluded from typecheck and deploys", () => {
    expect(readFileSync("tsconfig.json", "utf8")).toMatch(/"exclude":\s*\[[^\]]*"vendor"/);
    expect(readFileSync(".vercelignore", "utf8")).toMatch(/^vendor\/$/m);
  });
  it("the risky folders were not copied", () => {
    for (const repo of ["vendor/openexecutive", "vendor/awesome-ai-agents"]) {
      for (const bad of [".claude", ".github", ".git"]) expect(() => statSync(join(repo, bad))).toThrow();
    }
  });
});
