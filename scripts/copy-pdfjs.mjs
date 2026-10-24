// pdf.js fetches character maps, the 14 standard fonts and its image decoders
// at run time. This copies them into public/ so they ship inside the app.
import { cpSync, existsSync } from "node:fs";

for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = `node_modules/pdfjs-dist/${dir}`;
  if (existsSync(from)) cpSync(from, `public/pdfjs/${dir}`, { recursive: true });
}
