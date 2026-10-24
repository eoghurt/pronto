# Pronto

A PDF app that opens the file and gets out of the way. Built with Tauri, from the
Pronto lookbook (vol. 01, October 2026).

## Install

1. Download **Pronto-…-mac.dmg** from the [latest release](../../releases/latest). It runs on Apple silicon and Intel Macs, macOS 11 Big Sur or later.
2. Open the .dmg and drag **Pronto** onto **Applications**.
3. Open Pronto from Applications.

### Make Pronto open your PDFs

Click **Open all my PDFs in Pronto** under the buttons on Pronto's Open screen.
Double-clicking any PDF then opens it in Pronto. The link only shows while
another app is your PDF app, so if it comes back (Acrobat sometimes takes PDFs
back when it updates), click it again.

> **Don't use Finder's “Open With › Always Open With” for Pronto.** It tags
> each file with the app to use, and macOS refuses to open a downloaded file
> that's tagged for an app Apple hasn't notarized. You'll see “Apple could not
> verify ‘…pdf’ is free of malware”, and the file won't open. The link above
> sets Pronto for all PDFs instead, which doesn't tag files. If a file already
> shows that warning, run this once to remove the tag:
>
> ```bash
> xattr -d com.apple.LaunchServices.OpenWith "path/to/file.pdf"
> ```

### The first time you open it

Pronto isn't signed with a paid Apple developer account, so the first time you open it macOS shows a warning that it can't check Pronto for malicious software, and doesn't open it. To open it anyway (you only do this once):

1. Click **Done** on the warning.
2. Open **System Settings › Privacy & Security**.
3. Scroll down to **Security**. Next to “Pronto was blocked to protect your Mac”, click **Open Anyway**.
4. Enter your Mac's password if it asks, then click **Open Anyway** again.

Or, in Terminal, run this once after dragging Pronto into Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Pronto.app
```

It takes away the “downloaded from the internet” mark that macOS checks, so Pronto opens normally.

## What it does

- **Opens fast.** Drop a PDF anywhere, press ⌘O, paste one from the clipboard,
  double-click one in Finder, or pick a recent file. It opens on page 1, ready
  to mark up.
- **Five tools in one pill**, each with its own colour, and every mark keeps it:
  - **Highlight** (H, Sunflower): drag across text, or drag a box on scanned pages.
  - **Type** (T, Cobalt): click anywhere and type. S / M / L sizes, and a Date
    button that stamps today's date where you click next.
  - **Draw** (D, Bubblegum): freehand, fine or bold. Quick strokes group into one drawing.
  - **Sign** (S, Mint): draw your signature once; after that a faint copy follows
    the pointer and one click places it.
  - **Pages** (P, Lilac): drag thumbnails to reorder, hover to turn or delete.
- Click any mark to select it, drag to move it, ⌫ to delete it, or pick a new colour.
- **On this page** counts the marks on the page you're looking at.
- **Recent** files are coloured by the last tool you used on them.
- ⌘S saves into the file. The share button (⇧⌘S) saves a marked-up copy.
- ⌘Z / ⇧⌘Z undo and redo. ⌘+ / ⌘− / ⌘0 zoom, or pinch.

Marks are written into the PDF itself when you save (flattened), so they look the
same in Preview, Acrobat, email previews and printers.

## Why it's fast

- No UI framework: the window loads a few small files and paints the paper colour first.
- pdf.js's worker starts as the app launches, before you pick a file.
- Only pages on or near the screen are drawn; far-away pages hand back their memory.
- Zooming stretches the pages instantly, then redraws them sharp once you stop.
- The save library (pdf-lib) only loads the first time you save.
- Files travel between Rust and the page as raw bytes, not text.

## Running it

```bash
npm install
npm run tauri dev       # the app, with live reload
npm run tauri build -- --target universal-apple-darwin --bundles dmg   # the release disk image
npm run dev             # just the page, in a browser, at localhost:1420
```

In a browser, `http://localhost:1420/?open=/tests/fixtures/consent-form.pdf` opens the test form.

## Checks

```bash
node tests/make-fixture.mjs      # rebuilds tests/fixtures/consent-form.pdf
node tests/save-check.mjs tests/fixtures/consent-form.pdf tests/fixtures/consent-marks.json out.pdf
swift tests/render.swift out.pdf .   # renders out.pdf's pages to PNGs to look at
```

`save-check` runs the real save code on a set of marks (every tool, a reordered
page, a turned page) so you can open the result and check where everything landed.

## Layout

- `src-tauri/src/lib.rs`: reading and saving files, Finder opens, clipboard PDFs.
- `src/editor.ts`: pages, tools, thumbnails, undo, zoom, saving.
- `src/marks.ts`: the mark model (stored in PDF coordinates) and colours.
- `src/save.ts`: writes marks and page changes into the PDF.
- `src/home.ts`, `src/recents.ts`: the Open screen.
- `src/styles.css`: the lookbook's colours and type.
