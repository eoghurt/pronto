// Builds tests/fixtures/consent-form.pdf: a two-page form with real text to select.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const doc = await PDFDocument.create();
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const sans = await doc.embedFont(StandardFonts.Helvetica);
const grey = rgb(0.35, 0.34, 0.4);

const p1 = doc.addPage([595, 842]);
p1.drawText("[SCHOOL NAME]", { x: 60, y: 770, size: 9, font: sans, color: grey });
p1.drawText("ENGLISH LEARNING AREA", { x: 420, y: 770, size: 9, font: sans, color: grey });
p1.drawText("Excursion consent form", { x: 60, y: 720, size: 24, font: serif });
const body = [
  "Year 12 Literature students will attend a performance of a set",
  "text at [venue] on [date]. Students travel by bus from the school",
  "and return before the end of the school day.",
  "",
  "Forms must be returned to the front office by [return date] for",
  "a student to attend. Students who do not attend will complete",
  "set work in the library.",
];
body.forEach((line, i) => p1.drawText(line, { x: 60, y: 680 - i * 20, size: 13, font: serif }));
["Student name", "Year and class", "Medical notes"].forEach((label, i) => {
  const y = 500 - i * 46;
  p1.drawText(label, { x: 60, y, size: 11, font: sans });
  p1.drawLine({ start: { x: 180, y: y - 4 }, end: { x: 535, y: y - 4 }, thickness: 0.8, color: rgb(0.8, 0.78, 0.85) });
});
p1.drawText("I give permission for my child to attend the excursion", { x: 60, y: 340, size: 13, font: serif });
p1.drawText("described above.", { x: 60, y: 320, size: 13, font: serif });
p1.drawLine({ start: { x: 60, y: 240 }, end: { x: 330, y: 240 }, thickness: 0.8, color: grey });
p1.drawLine({ start: { x: 380, y: 240 }, end: { x: 535, y: 240 }, thickness: 0.8, color: grey });
p1.drawText("Parent or guardian signature", { x: 60, y: 224, size: 10, font: sans });
p1.drawText("Date", { x: 380, y: 224, size: 10, font: sans });

const p2 = doc.addPage([595, 842]);
p2.drawText("Page two: what to bring", { x: 60, y: 760, size: 20, font: serif });
["A packed lunch and a water bottle.", "Your copy of the set text.", "A pen and a notebook for the post-show workshop."]
  .forEach((line, i) => p2.drawText(line, { x: 60, y: 720 - i * 20, size: 13, font: serif }));

writeFileSync("tests/fixtures/consent-form.pdf", await doc.save());
console.log("wrote tests/fixtures/consent-form.pdf");
