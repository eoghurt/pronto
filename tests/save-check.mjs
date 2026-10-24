// Runs Pronto's real save code (src/save.ts) on a PDF and a set of marks, and
// writes the result, so the output can be opened or rendered and looked at.
//   node tests/save-check.mjs <in.pdf> <marks.json> <out.pdf>
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const [input, marksFile, output] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { buildPdf } = await server.ssrLoadModule("/src/save.ts");
  const { marks, slots } = JSON.parse(readFileSync(marksFile, "utf8"));
  const bytes = await buildPdf(new Uint8Array(readFileSync(input)), marks, slots);
  writeFileSync(output, bytes);
  console.log(`wrote ${output} (${bytes.length} bytes)`);
} finally {
  await server.close();
}
