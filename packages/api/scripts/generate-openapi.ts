import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildOpenApiDocument } from "../src/openapi/document.js";

// Run via `pnpm --filter @llm-gateway/api generate:openapi`. Writes a static, checked-in artifact
// to <repo root>/openapi/openapi.json — not invoked by the running app. Re-run and commit the
// diff whenever a route changes.
const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "../../../openapi");
const outputPath = join(outputDir, "openapi.json");

const document = buildOpenApiDocument();
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");

console.log(`Wrote OpenAPI document to ${outputPath}`);
