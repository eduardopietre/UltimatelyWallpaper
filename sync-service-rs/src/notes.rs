use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{json, Value};

use crate::config::{notes_enabled_from_value, Config};
use crate::error::AppError;

static TASK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([ \t]*)-\s+\[([ xX])\]\s?(.*)$").unwrap());
static HEADING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(#{1,6})\s+(.+)$").unwrap());

const APP_TITLE: &str = "Ultimately Wallpaper";

pub fn get_notes_config(cfg: &Config) -> Value {
    json!({
        "enabled": cfg.notes_enabled,
        "folderPath": cfg.notes_folder_path,
    })
}

pub fn notes_enabled(cfg: &Config) -> bool {
    cfg.notes_enabled || notes_enabled_from_value(Some(if cfg.notes_enabled { "1" } else { "0" }))
}

pub fn normalize_notes_root(folder_path: &str) -> Result<PathBuf, AppError> {
    let root = PathBuf::from(folder_path);
    let root = dunce_canonicalize(&root).map_err(|_| {
        AppError::bad_request("NOTES_FOLDER_PATH must be an existing directory")
    })?;
    if !root.is_dir() {
        return Err(AppError::bad_request(
            "NOTES_FOLDER_PATH must be an existing directory",
        ));
    }
    Ok(root)
}

fn dunce_canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    fs::canonicalize(path)
}

pub fn list_markdown_files(folder_path: &str) -> Result<Vec<Value>, AppError> {
    let root = normalize_notes_root(folder_path)?;
    let mut files = Vec::new();
    collect_md(&root, &root, &mut files);
    files.sort_by(|a, b| {
        a["path"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase()
            .cmp(&b["path"].as_str().unwrap_or("").to_ascii_lowercase())
    });
    Ok(files)
}

fn collect_md(root: &Path, dir: &Path, out: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_md(root, &path, out);
        } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")).unwrap_or(false) {
            if let Ok(rel) = path.strip_prefix(root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                out.push(json!({ "path": rel, "name": rel }));
            }
        }
    }
}

pub fn resolve_note_file(folder_path: &str, relative_path: &str) -> Result<PathBuf, AppError> {
    if relative_path.is_empty() || Path::new(relative_path).is_absolute() {
        return Err(AppError::bad_request("Invalid notes file path"));
    }
    let root = normalize_notes_root(folder_path)?;
    let target = root.join(relative_path);
    let target = dunce_canonicalize(&target).map_err(|_| AppError::not_found("Notes file not found"))?;
    if !target.starts_with(&root) {
        return Err(AppError::bad_request("Invalid notes file path"));
    }
    if target.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")) != Some(true)
    {
        return Err(AppError::bad_request("Notes file must be a markdown file"));
    }
    if !target.is_file() {
        return Err(AppError::not_found("Notes file not found"));
    }
    Ok(target)
}

pub fn read_note_file(folder_path: &str, relative_path: &str) -> Result<Value, AppError> {
    let target = resolve_note_file(folder_path, relative_path)?;
    let text = fs::read_to_string(&target).map_err(|e| AppError::internal(e.to_string()))?;
    let updated_at = target
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    Ok(json!({
        "path": relative_path,
        "updatedAt": updated_at,
        "tasks": parse_markdown_tasks(&text),
        "headings": parse_markdown_headings(&text),
    }))
}

fn parse_markdown_headings(text: &str) -> Vec<Value> {
    text.lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let m = HEADING_RE.captures(line.trim())?;
            Some(json!({
                "lineIndex": index,
                "level": m[1].len(),
                "text": m[2].trim(),
            }))
        })
        .collect()
}

fn parse_markdown_tasks(text: &str) -> Vec<Value> {
    text.lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let m = TASK_RE.captures(line)?;
            let indent = &m[1];
            let marker = &m[2];
            let task_text = &m[3];
            let depth = task_depth(indent);
            Some(json!({
                "lineIndex": index,
                "text": task_text,
                "checked": marker.eq_ignore_ascii_case("x"),
                "depth": depth,
                "raw": line,
            }))
        })
        .collect()
}

fn task_depth(indent: &str) -> usize {
    let tabs = indent.matches('\t').count();
    let spaces = indent.replace('\t', "").len() / 4;
    tabs + spaces
}

fn indent_for_depth(depth: usize) -> String {
    "    ".repeat(depth)
}

fn format_task_line(indent: &str, checked: bool, text: &str) -> String {
    let marker = if checked { 'x' } else { ' ' };
    format!("{indent}- [{marker}] {text}")
}

fn read_note_lines(folder_path: &str, relative_path: &str) -> Result<(PathBuf, String, Vec<String>), AppError> {
    let target = resolve_note_file(folder_path, relative_path)?;
    let original = fs::read_to_string(&target).map_err(|e| AppError::internal(e.to_string()))?;
    let lines: Vec<String> = original.lines().map(|s| s.to_string()).collect();
    Ok((target, original, lines))
}

fn assert_task_line(
    lines: &[String],
    line_index: usize,
    expected_text: Option<&str>,
) -> Result<(String, String, String, usize), AppError> {
    let line = lines
        .get(line_index)
        .ok_or_else(|| AppError::conflict("Task line no longer exists"))?;
    let m = TASK_RE
        .captures(line)
        .ok_or_else(|| AppError::conflict("Task line no longer matches a markdown task"))?;
    let indent = m[1].to_string();
    let marker = m[2].to_string();
    let text = m[3].to_string();
    if let Some(expected) = expected_text {
        if text != expected {
            return Err(AppError::conflict("Task line changed on disk"));
        }
    }
    let depth = task_depth(&indent);
    Ok((indent, marker, text, depth))
}

fn find_task_block_end(lines: &[String], start_index: usize) -> Result<usize, AppError> {
    let (_, _, _, start_depth) = assert_task_line(lines, start_index, None)?;
    let mut index = start_index + 1;
    while index < lines.len() {
        if let Some(m) = TASK_RE.captures(&lines[index]) {
            if task_depth(&m[1]) <= start_depth {
                break;
            }
        }
        index += 1;
    }
    Ok(index)
}

fn write_note_lines(target: &Path, lines: &[String], original_text: &str) -> Result<(), AppError> {
    let keep_newline = original_text.ends_with('\n');
    let newline = if original_text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut output = lines.join(newline);
    if keep_newline || !output.is_empty() {
        output.push_str(newline);
    }

    let tmp_path = target.with_file_name(format!(
        "{}.{}.tmp",
        target.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));

    let mut last_err = None;
    for attempt in 0..6 {
        match fs::write(&tmp_path, &output).and_then(|_| fs::rename(&tmp_path, target)) {
            Ok(()) => return Ok(()),
            Err(err) => {
                let _ = fs::remove_file(&tmp_path);
                last_err = Some(err);
                if attempt < 5 {
                    thread::sleep(Duration::from_millis(50 * (1 << attempt)));
                }
            }
        }
    }

    if let Err(err) = fs::write(target, &output) {
        last_err = Some(err);
    } else {
        return Ok(());
    }

    let err = last_err.unwrap();
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        return Err(AppError::bad_request(
            "Note file is locked. Close Obsidian or wait for iCloud sync, then try again.",
        ));
    }
    Err(AppError::bad_request(format!(
        "Failed to write note file: {}",
        target.file_name().unwrap().to_string_lossy()
    )))
}

pub fn set_task_checked(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    checked: bool,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let (indent, _, task_text, _) = assert_task_line(&lines, line_index, expected_text)?;
    lines[line_index] = format_task_line(&indent, checked, &task_text);
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn add_task(
    folder_path: &str,
    relative_path: &str,
    text: &str,
    after_line_index: Option<usize>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let cleaned = text.trim();
    if cleaned.is_empty() {
        return Err(AppError::bad_request("Task text is required"));
    }
    let new_line = format!("{}- [ ] {cleaned}", indent_for_depth(0));
    match after_line_index {
        Some(idx) if idx < lines.len() => lines.insert(idx + 1, new_line),
        _ => lines.push(new_line),
    }
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn update_task_text(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    text: &str,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let cleaned = text.trim();
    if cleaned.is_empty() {
        return Err(AppError::bad_request("Task text is required"));
    }
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let (indent, marker, _, _) = assert_task_line(&lines, line_index, expected_text)?;
    lines[line_index] = format_task_line(&indent, marker.eq_ignore_ascii_case("x"), cleaned);
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn add_subtask(
    folder_path: &str,
    relative_path: &str,
    parent_line_index: usize,
    text: &str,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let (_, _, _, parent_depth) = assert_task_line(&lines, parent_line_index, expected_text)?;
    let cleaned = text.trim();
    if cleaned.is_empty() {
        return Err(AppError::bad_request("Task text is required"));
    }
    if parent_depth + 1 > 8 {
        return Err(AppError::bad_request("Maximum nesting reached"));
    }
    let insert_at = find_task_block_end(&lines, parent_line_index)?;
    let new_line = format!("{}- [ ] {cleaned}", indent_for_depth(parent_depth + 1));
    lines.insert(insert_at, new_line);
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

fn find_previous_sibling(lines: &[String], line_index: usize) -> Result<Option<usize>, AppError> {
    let (_, _, _, depth) = assert_task_line(lines, line_index, None)?;
    let mut scan = line_index as isize - 1;
    while scan >= 0 {
        if let Some(m) = TASK_RE.captures(&lines[scan as usize]) {
            let sibling_depth = task_depth(&m[1]);
            if sibling_depth == depth {
                return Ok(Some(scan as usize));
            }
            if sibling_depth < depth {
                return Ok(None);
            }
        }
        scan -= 1;
    }
    Ok(None)
}

fn find_next_sibling(lines: &[String], block_end: usize, depth: usize) -> Option<usize> {
    let mut scan = block_end;
    while scan < lines.len() {
        if let Some(m) = TASK_RE.captures(&lines[scan]) {
            let sibling_depth = task_depth(&m[1]);
            if sibling_depth == depth {
                return Some(scan);
            }
            if sibling_depth < depth {
                return None;
            }
        }
        scan += 1;
    }
    None
}

fn shift_block_depth(lines: &mut [String], start: usize, end: usize, delta: isize) -> Result<(), AppError> {
    for index in start..end {
        let line = lines[index].clone();
        let Some(m) = TASK_RE.captures(&line) else {
            continue;
        };
        let next_depth = task_depth(&m[1]) as isize + delta;
        if next_depth < 0 {
            return Err(AppError::conflict("Task is already at the top level"));
        }
        if next_depth > 8 {
            return Err(AppError::bad_request("Maximum nesting reached"));
        }
        lines[index] = format_task_line(
            &indent_for_depth(next_depth as usize),
            m[2].eq_ignore_ascii_case("x"),
            &m[3],
        );
    }
    Ok(())
}

pub fn move_task(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    direction: &str,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let (_, _, _, depth) = assert_task_line(&lines, line_index, expected_text)?;
    let block_start = line_index;
    let block_end = find_task_block_end(&lines, line_index)?;
    let block: Vec<String> = lines[block_start..block_end].to_vec();

    if direction == "up" {
        let previous = find_previous_sibling(&lines, line_index)?
            .ok_or_else(|| AppError::conflict("Task is already at the top"))?;
        let previous_end = find_task_block_end(&lines, previous)?;
        let previous_block: Vec<String> = lines[previous..previous_end].to_vec();
        let mut new_lines = Vec::new();
        new_lines.extend_from_slice(&lines[..previous]);
        new_lines.extend(block);
        new_lines.extend(previous_block);
        new_lines.extend_from_slice(&lines[block_end..]);
        lines = new_lines;
    } else {
        let next_index = find_next_sibling(&lines, block_end, depth)
            .ok_or_else(|| AppError::conflict("Task is already at the bottom"))?;
        let next_end = find_task_block_end(&lines, next_index)?;
        let next_block: Vec<String> = lines[next_index..next_end].to_vec();
        let mut new_lines = Vec::new();
        new_lines.extend_from_slice(&lines[..block_start]);
        new_lines.extend(next_block);
        new_lines.extend(block);
        new_lines.extend_from_slice(&lines[next_end..]);
        lines = new_lines;
    }

    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn indent_task(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    assert_task_line(&lines, line_index, expected_text)?;
    let mut previous_index = line_index as isize - 1;
    while previous_index >= 0 && TASK_RE.captures(&lines[previous_index as usize]).is_none() {
        previous_index -= 1;
    }
    if previous_index < 0 {
        return Err(AppError::conflict("Cannot indent without a previous task"));
    }
    let block_end = find_task_block_end(&lines, line_index)?;
    shift_block_depth(&mut lines, line_index, block_end, 1)?;
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn outdent_task(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    let (_, _, _, depth) = assert_task_line(&lines, line_index, expected_text)?;
    if depth == 0 {
        return Err(AppError::conflict("Task is already at the top level"));
    }
    let block_end = find_task_block_end(&lines, line_index)?;
    shift_block_depth(&mut lines, line_index, block_end, -1)?;
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn delete_task(
    folder_path: &str,
    relative_path: &str,
    line_index: usize,
    expected_text: Option<&str>,
) -> Result<Value, AppError> {
    let (target, original, mut lines) = read_note_lines(folder_path, relative_path)?;
    assert_task_line(&lines, line_index, expected_text)?;
    let block_end = find_task_block_end(&lines, line_index)?;
    lines.drain(line_index..block_end);
    write_note_lines(&target, &lines, &original)?;
    read_note_file(folder_path, relative_path)
}

pub fn open_note_file_externally(folder_path: &str, relative_path: &str) -> Result<(), AppError> {
    let target = resolve_note_file(folder_path, relative_path)?;
    open::that(&target).map_err(|e| AppError::internal(e.to_string()))
}

pub fn pick_notes_folder(initial_dir: Option<&str>, title: Option<&str>) -> Result<Option<String>, AppError> {
    #[cfg(not(windows))]
    {
        let _ = (initial_dir, title);
        return Err(AppError::not_implemented(
            "Folder picker is only supported on Windows",
        ));
    }
    #[cfg(windows)]
    {
        let initial = resolve_initial_dir(initial_dir);
        let title = dialog_title(title.unwrap_or("Select notes folder"));
        let folder = rfd::FileDialog::new()
            .set_title(&title)
            .set_directory(initial)
            .pick_folder();
        Ok(folder.map(|p| p.to_string_lossy().to_string()))
    }
}

pub fn prompt_text(title: &str, prompt: &str, initial: &str) -> Result<Option<String>, AppError> {
    #[cfg(not(windows))]
    {
        let _ = (title, prompt, initial);
        return Err(AppError::not_implemented(
            "Text prompt is only supported on Windows",
        ));
    }
    #[cfg(windows)]
    {
        // rfd has no text input; use a simple folder-less MessageDialog fallback via Input
        // Use rfd AsyncMessageDialog isn't text input. Use a minimal Win32-free approach:
        // write prompt to a temp and use InputBox via powershell - still heavy.
        // Prefer rfd isn't enough — use a custom approach with `rfd` isn't available for text.
        // Fallback: use Windows `InputBox` via PowerShell for parity.
        use std::process::Command;
        let title = dialog_title(title);
        let script = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('{prompt}', '{title}', '{initial}')",
            prompt = escape_ps(prompt),
            title = escape_ps(&title),
            initial = escape_ps(initial),
        );
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script]);
        crate::process_win::hide_console(&mut command);
        let output = command
            .output()
            .map_err(|e| AppError::internal(e.to_string()))?;
        if !output.status.success() {
            return Err(AppError::internal("Text prompt failed"));
        }
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    }
}

fn escape_ps(value: &str) -> String {
    value.replace('\'', "''")
}

fn dialog_title(title: &str) -> String {
    let clean = title.trim();
    if clean.starts_with(APP_TITLE) {
        clean.to_string()
    } else {
        format!("{APP_TITLE} — {clean}")
    }
}

fn resolve_initial_dir(initial_dir: Option<&str>) -> PathBuf {
    if let Some(dir) = initial_dir {
        let candidate = PathBuf::from(dir);
        if candidate.is_dir() {
            return candidate;
        }
        if let Some(parent) = candidate.parent() {
            if parent.is_dir() {
                return parent.to_path_buf();
            }
        }
    }
    dirs_next_home()
}

fn dirs_next_home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
