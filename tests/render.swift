// Renders each page of a PDF to page<N>.png (respecting page rotation) and prints its text.
//   swift tests/render.swift <in.pdf> <out-dir>
import PDFKit
import AppKit

let args = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: args[1]))!
for i in 0..<doc.pageCount {
  let p = doc.page(at: i)!
  let b = p.bounds(for: .mediaBox)
  let turned = p.rotation % 180 != 0
  let size = NSSize(width: (turned ? b.height : b.width) * 1.6, height: (turned ? b.width : b.height) * 1.6)
  let img = p.thumbnail(of: size, for: .mediaBox)
  let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(args[2])/page\(i+1).png"))
  print("page \(i+1) rotation \(p.rotation)")
  print(p.string ?? "")
  print("-----")
}
