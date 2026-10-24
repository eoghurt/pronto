// The native half of Pronto: reading and writing PDF files, files handed to the
// app by Finder ("Open with Pronto", double-clicks, drops on the Dock icon), and
// PDFs on the clipboard. Everything else lives in the web view.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use tauri::{
    ipc::{InvokeBody, Request, Response},
    Emitter, Manager, RunEvent, State,
};

/// Files waiting to be opened. Finder can hand over a file before the web
/// view is listening, so paths queue here and the page drains them.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

/// The file's bytes, sent as raw binary rather than JSON so big PDFs arrive quickly.
#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Couldn't open {}: {}", path, e))
}

/// Writes the page's bytes to the path in the `x-path` header (percent-encoded).
/// It writes a temporary file beside the original first and then swaps it in,
/// so a failed save never leaves half a PDF behind.
#[tauri::command]
fn write_pdf(request: Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("No file path was given")?;
    let path = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the PDF's bytes".into());
    };
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("pdf.pronto-saving");
    fs::write(&tmp, bytes).map_err(|e| format!("Couldn't save {}: {}", path, e))?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Couldn't save {}: {}", path, e)
    })
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
fn take_pending(pending: State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

fn osascript(script: &str) -> Option<String> {
    let out = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// A PDF on the clipboard, as a path: a file copied in Finder, a copied path,
/// or PDF data (copied from Preview or a browser), which is saved to a
/// temporary file first.
#[tauri::command]
fn clipboard_pdf(app: tauri::AppHandle) -> Option<String> {
    if let Some(p) = osascript("POSIX path of (the clipboard as «class furl»)") {
        if is_pdf(Path::new(&p)) && Path::new(&p).is_file() {
            return Some(p);
        }
    }
    if let Some(text) = osascript("the clipboard as text") {
        let text = text.trim().trim_start_matches("file://");
        let decoded = percent_encoding::percent_decode_str(text)
            .decode_utf8_lossy()
            .to_string();
        let p = Path::new(&decoded);
        if is_pdf(p) && p.is_file() {
            return Some(decoded);
        }
    }
    // PDF data comes back from AppleScript as «data PDF 2550…» hex.
    let raw = osascript("the clipboard as «class PDF »")?;
    let hex = raw.strip_prefix("«data PDF ")?.strip_suffix('»')?;
    let bytes: Vec<u8> = (0..hex.len() / 2)
        .filter_map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok())
        .collect();
    if !bytes.starts_with(b"%PDF") {
        return None;
    }
    let dir = app.path().app_cache_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let path = dir.join(format!("Pasted PDF {}.pdf", stamp));
    fs::write(&path, bytes).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn queue(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<Pending>().0.lock().unwrap().extend(paths);
    let _ = app.emit("pending-files", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let from_args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| is_pdf(Path::new(a)))
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending(Mutex::new(from_args)))
        .invoke_handler(tauri::generate_handler![
            read_pdf,
            write_pdf,
            file_exists,
            take_pending,
            clipboard_pdf
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Pronto")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let RunEvent::Opened { urls } = &event {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .filter(|p| is_pdf(p))
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                queue(app, paths);
            }
            let _ = (app, event);
        });
}
