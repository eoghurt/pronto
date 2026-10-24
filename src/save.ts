// Writes marks and page changes into the PDF with pdf-lib. Loaded only when
// you first save, so it never slows down opening.

import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import { smoothPath, textBaselines, type Mark, type Slot } from "./marks";

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Helvetica covers Western European text; anything else becomes "?". */
function encodable(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

export async function buildPdf(original: Uint8Array, marks: Mark[], slots: Slot[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const pages = doc.getPages();
  let font: PDFFont | null = null;

  for (const m of marks) {
    const page = pages[m.page];
    if (!page) continue;
    const colour = toRgb(m.color);
    if (m.kind === "highlight") {
      for (const [x1, y1, x2, y2] of m.rects) {
        page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: colour, blendMode: BlendMode.Multiply });
      }
    } else if (m.kind === "text") {
      font ??= await doc.embedFont(StandardFonts.Helvetica);
      for (const { line, at } of textBaselines(m)) {
        if (!line.trim()) continue;
        page.drawText(encodable(font, line), { x: at[0], y: at[1], size: m.size, font, color: colour, rotate: degrees(m.rot) });
      }
    } else {
      for (const stroke of m.strokes) {
        // drawSvgPath flips y, so the path is given with y negated.
        const d = smoothPath(stroke.map(([x, y]) => [x, -y]));
        page.drawSvgPath(d, { x: 0, y: 0, borderColor: colour, borderWidth: m.width, borderLineCap: LineCapStyle.Round });
      }
    }
  }

  for (const s of slots) {
    if (!s.rot) continue;
    const page = pages[s.src];
    page.setRotation(degrees((((page.getRotation().angle + s.rot) % 360) + 360) % 360));
  }

  const unchanged = slots.length === pages.length && slots.every((s, i) => s.src === i);
  if (!unchanged) {
    for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
    for (const s of slots) doc.addPage(pages[s.src]);
  }

  return doc.save();
}
