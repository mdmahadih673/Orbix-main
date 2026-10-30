use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use base64::Engine;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;
use windows::core::PCWSTR;
use windows::Win32::Security::Credentials::{
    CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

const CREDENTIAL_TARGET: &str = "Orbix.GoogleGemini.ApiKey";
const MODEL: &str = "gemini-3.1-flash-lite";

#[tauri::command]
pub fn assistant_open(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("assistant").ok_or_else(|| {
        "Assistant window is unavailable. Restart Orbix and try again.".to_string()
    })?;
    window
        .center()
        .map_err(|e| format!("Could not center Assistant: {e}"))?;
    window
        .show()
        .map_err(|e| format!("Could not show Assistant: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("Could not focus Assistant: {e}"))
}

fn target_name() -> Vec<u16> {
    CREDENTIAL_TARGET.encode_utf16().chain(Some(0)).collect()
}

fn read_api_key() -> Result<String, String> {
    let target = target_name();
    let mut credential = std::ptr::null_mut();
    unsafe {
        CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut credential,
        )
        .map_err(|_| "Gemini API key is not set yet.".to_string())?;
        let entry = &*credential;
        let key = if entry.CredentialBlob.is_null() || entry.CredentialBlobSize == 0 {
            Err("Saved API key is empty.".to_string())
        } else {
            let bytes =
                std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize);
            String::from_utf8(bytes.to_vec()).map_err(|_| "Saved API key is invalid.".to_string())
        };
        CredFree(credential.cast());
        key
    }
}

#[tauri::command]
pub fn assistant_has_key() -> bool {
    read_api_key().is_ok()
}

#[tauri::command]
pub fn assistant_save_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.len() < 20 || api_key.len() > 512 {
        return Err("Enter a valid Google AI Studio API key.".into());
    }
    let target = target_name();
    let username: Vec<u16> = "Orbix Gemini".encode_utf16().chain(Some(0)).collect();
    let mut blob = api_key.as_bytes().to_vec();
    let mut credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: windows::core::PWSTR(target.as_ptr() as *mut _),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: windows::core::PWSTR(username.as_ptr() as *mut _),
        ..Default::default()
    };
    unsafe { CredWriteW(&mut credential, 0).map_err(|e| format!("Could not save API key: {e}")) }
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<ApiError>,
}
#[derive(Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
    #[serde(rename = "groundingMetadata")]
    grounding_metadata: Option<GroundingMetadata>,
}
#[derive(Deserialize)]
struct CandidateContent {
    parts: Option<Vec<CandidatePart>>,
}
#[derive(Deserialize)]
struct CandidatePart {
    text: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroundingMetadata {
    grounding_chunks: Option<Vec<GroundingChunk>>,
}
#[derive(Deserialize)]
struct GroundingChunk {
    web: Option<WebCitation>,
}
#[derive(Deserialize, Serialize)]
pub struct WebCitation {
    pub title: Option<String>,
    pub uri: Option<String>,
}
#[derive(Deserialize)]
struct ApiError {
    message: String,
}

#[derive(Deserialize)]
struct LiveTokenResponse {
    name: Option<String>,
    error: Option<ApiError>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReply {
    pub reply: String,
    pub action: Option<AssistantAction>,
    #[serde(default)]
    pub sources: Vec<WebCitation>,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AssistantAction {
    SearchFiles {
        #[serde(default)]
        query: String,
    },
    LaunchApp {
        #[serde(default)]
        name: String,
    },
    OpenFile {
        #[serde(default)]
        query: String,
    },
    OpenUrl {
        #[serde(default)]
        url: String,
    },
    SetVolume {
        #[serde(default)]
        volume: u8,
    },
    DiagnoseWorkspace,
    WriteWorkspaceFile {
        #[serde(default)]
        path: String,
        #[serde(default)]
        content: String,
    },
}

#[tauri::command]
pub async fn assistant_ask(message: String, workspace_context: Option<String>) -> Result<AssistantReply, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 8000 {
        return Err("Write a message up to 8,000 characters.".into());
    }
    let key = read_api_key()?;
    let url =
        format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent");
    let body = serde_json::json!({
        "systemInstruction": {"parts": [{"text": "You are Lulu, a concise desktop helper. Reply in the user's language. For every current, recent, or time-sensitive question (including sports fixtures, scores, news, schedules, weather, and prices), you MUST use Google Search before answering. Summarize the search results and include the source URLs in the answer when available. If web search fails or returns no usable sources, say that clearly; never claim you cannot browse or invent a technical problem. When asked to find a file, return action {type: search_files, query: short filename or search term}. When asked to open a file, return action {type: open_file, query: short filename or search term}. When asked to open or launch an app, return action {type: launch_app, name: exact or common app name}. When asked to open a specific website or URL in the browser, return action {type: open_url, url: absolute http or https URL}. When asked to change system sound, return action {type: set_volume, volume: integer from 0 to 100}. When a selected project context is supplied and the user asks to find code errors, return action {type: diagnose_workspace}. When the user explicitly asks to create or change code in the selected project, return action {type: write_workspace_file, path: relative project path, content: full new file content}. Never use absolute paths in project actions. Lulu can carry out these user-requested actions locally. Never invent file paths or launch a different app than requested. For normal questions set action to null. Return only JSON with keys reply (string) and action (object or null)."}]},
        "contents": [{"role": "user", "parts": [{"text": if let Some(context) = workspace_context.filter(|value| !value.trim().is_empty()) { format!("{message}\n\nSelected project context, provided only with the user's code-sharing consent:\n{context}") } else { message.to_string() }}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "reply": {"type": "STRING"},
                    "action": {
                        "type": "OBJECT",
                        "nullable": true,
                        "properties": {
                            "type": {"type": "STRING", "enum": ["search_files", "launch_app", "open_file", "open_url", "set_volume", "diagnose_workspace", "write_workspace_file"]},
                            "query": {"type": "STRING", "nullable": true},
                            "name": {"type": "STRING", "nullable": true},
                            "url": {"type": "STRING", "nullable": true},
                            "volume": {"type": "INTEGER", "minimum": 0, "maximum": 100, "nullable": true},
                            "path": {"type": "STRING", "nullable": true},
                            "content": {"type": "STRING", "nullable": true}
                        },
                        "required": ["type"]
                    }
                },
                "required": ["reply", "action"]
            }
        }
    });
    let response = reqwest::Client::new()
        .post(url)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gemini: {e}"))?;
    let status = response.status();
    let payload: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Gemini returned an unreadable response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| format!("Gemini API error ({status}).")));
    }
    let candidate = payload
        .candidates
        .and_then(|items| items.into_iter().next())
        .ok_or_else(|| "Gemini did not return an answer.".to_string())?;
    let text = candidate.content
        .and_then(|content| content.parts)
        .and_then(|parts| parts.into_iter().find_map(|part| part.text))
        .ok_or_else(|| "Gemini did not return an answer.".to_string())?;
    let mut result: AssistantReply = serde_json::from_str(&text)
        .map_err(|_| "Gemini returned an invalid assistant response.".to_string())?;
    result.sources = candidate
        .grounding_metadata
        .and_then(|metadata| metadata.grounding_chunks)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|chunk| chunk.web)
        .filter(|web| web.uri.as_deref().is_some_and(|uri| uri.starts_with("https://") || uri.starts_with("http://")))
        .collect();
    Ok(result)
}

fn canonical_workspace(path: &str) -> Result<PathBuf, String> {
    let root = Path::new(path).canonicalize().map_err(|e| format!("Could not open selected project folder: {e}"))?;
    if !root.is_dir() { return Err("The selected project path is not a folder.".into()); }
    Ok(root)
}

fn safe_workspace_file(root: &Path, relative: &str, create_parent: bool) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative.trim().is_empty() || relative_path.is_absolute() || relative_path.components().any(|part| !matches!(part, Component::Normal(_) | Component::CurDir)) {
        return Err("Use a relative file path inside the selected project folder.".into());
    }
    let target = root.join(relative_path);
    let parent = target.parent().ok_or_else(|| "Invalid project file path.".to_string())?;
    if create_parent { std::fs::create_dir_all(parent).map_err(|e| format!("Could not create project folder: {e}"))?; }
    let canonical_parent = parent.canonicalize().map_err(|e| format!("Project subfolder does not exist: {e}"))?;
    if !canonical_parent.starts_with(root) { return Err("Project file path leaves the selected folder.".into()); }
    let destination = canonical_parent.join(target.file_name().ok_or_else(|| "Invalid project file name.".to_string())?);
    if destination.exists() {
        let canonical_destination = destination.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_destination.starts_with(root) { return Err("Project file resolves outside the selected folder.".into()); }
        return Ok(canonical_destination);
    }
    Ok(destination)
}

#[tauri::command]
pub async fn assistant_get_workspace_context(workspace_path: String, query: String) -> Result<String, String> {
    let root = canonical_workspace(&workspace_path)?;
    let query_terms: Vec<String> = query.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .filter(|word| word.len() > 2).map(str::to_lowercase).collect();
    let mut queue = std::collections::VecDeque::from([(root.clone(), 0usize)]);
    let mut candidates: Vec<(usize, std::time::SystemTime, PathBuf)> = Vec::new();
    let mut tree: Vec<String> = Vec::new();
    let mut inspected = 0usize;
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > 7 || inspected >= 1600 { continue; }
        let entries = match std::fs::read_dir(&directory) { Ok(entries) => entries, Err(_) => continue };
        for entry in entries.flatten() {
            inspected += 1;
            if inspected >= 1600 { break; }
            let name = entry.file_name().to_string_lossy().to_string();
            if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".venv" | "venv" | "coverage" | "vendor") { continue; }
            let kind = match entry.file_type() { Ok(kind) => kind, Err(_) => continue };
            if kind.is_symlink() { continue; }
            let path = entry.path();
            let relative = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            if kind.is_dir() {
                if tree.len() < 220 { tree.push(format!("{relative}/")); }
                queue.push_back((path, depth + 1));
                continue;
            }
            let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(), "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "html" | "css" | "json" | "toml" | "md" | "cs" | "java" | "go" | "vue" | "svelte" | "sql" | "yaml" | "yml") { continue; }
            if tree.len() < 220 { tree.push(relative.clone()); }
            let rank = query_terms.iter().filter(|term| relative.to_lowercase().contains(term.as_str())).count();
            let modified = entry.metadata().and_then(|meta| meta.modified()).unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((rank, modified, path));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    tree.sort();
    let mut context = format!("Project file tree (partial, up to 220 entries):\n{}\n\nSelected source excerpts:\n", tree.join("\n"));
    let mut remaining = 22_000usize;
    for (_, _, path) in candidates.into_iter().take(12) {
        if remaining < 1200 { break; }
        let relative = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        let Ok(contents) = std::fs::read_to_string(&path) else { continue };
        if contents.len() > 16_000 { continue; }
        let excerpt = contents.chars().take(remaining.saturating_sub(relative.len() + 40)).collect::<String>();
        let block = format!("\n--- {relative} ---\n{excerpt}\n");
        remaining = remaining.saturating_sub(block.len());
        context.push_str(&block);
    }
    Ok(context)
}

#[tauri::command]
pub fn assistant_write_workspace_file(workspace_path: String, path: String, content: String) -> Result<String, String> {
    if content.len() > 1_000_000 { return Err("Generated file is too large (limit: 1 MB).".into()); }
    let root = canonical_workspace(&workspace_path)?;
    let target = safe_workspace_file(&root, &path, true)?;
    std::fs::write(&target, content).map_err(|e| format!("Could not write project file: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn assistant_open_vscode_file(workspace_path: String, path: String) -> Result<(), String> {
    let root = canonical_workspace(&workspace_path)?;
    let target = safe_workspace_file(&root, &path, false)?;
    if !target.is_file() { return Err("The selected project file does not exist.".into()); }
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into());
    let candidates = [PathBuf::from(&local_app_data).join("Programs/Microsoft VS Code/Code.exe"), PathBuf::from(&program_files).join("Microsoft VS Code/Code.exe"), PathBuf::from(&program_files_x86).join("Microsoft VS Code/Code.exe")];
    let executable = candidates.into_iter().find(|path| path.is_file()).ok_or_else(|| "VS Code was not found in its standard install locations.".to_string())?;
    Command::new(executable).arg("--reuse-window").arg(target).creation_flags(0x08000000).spawn()
        .map(|_| ()).map_err(|e| format!("Could not open project file in VS Code: {e}"))
}

#[tauri::command]
pub async fn assistant_diagnose_workspace(workspace_path: String) -> Result<WorkspaceDiagnostics, String> {
    let root = canonical_workspace(&workspace_path)?;
    let package_file = root.join("package.json");
    let cargo_file = root.join("Cargo.toml");
    let (command, mut process) = if package_file.is_file() {
        let bytes = std::fs::read(&package_file).map_err(|e| e.to_string())?;
        let package: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("Could not read package.json: {e}"))?;
        if package.get("scripts").and_then(|scripts| scripts.get("build")).and_then(|value| value.as_str()).is_none() { return Err("No package.json build script was found.".into()); }
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c", "npm.cmd run build"]);
        ("npm run build".to_string(), command)
    } else if cargo_file.is_file() {
        let mut command = Command::new("cargo");
        command.args(["check", "--quiet"]);
        ("cargo check --quiet".to_string(), command)
    } else { return Err("No package.json build script or Cargo.toml was found in the selected folder.".into()); };
    process.current_dir(&root).creation_flags(0x08000000);
    let output = tauri::async_runtime::spawn_blocking(move || process.output())
        .await.map_err(|e| e.to_string())?.map_err(|e| format!("Could not run project diagnostics: {e}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if text.len() > 14_000 { text.truncate(14_000); text.push_str("\n…diagnostic output truncated"); }
    Ok(WorkspaceDiagnostics { command, exit_code: output.status.code(), output: text })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiagnostics { pub command: String, pub exit_code: Option<i32>, pub output: String }

#[tauri::command]
pub async fn assistant_transcribe_audio(audio_base64: String, mime_type: String) -> Result<String, String> {
    let mime_type = mime_type.split(';').next().unwrap_or_default().trim().to_lowercase();
    let supported_mime = matches!(
        mime_type.as_str(),
        "audio/webm" | "audio/ogg" | "audio/wav" | "audio/mp4" | "audio/mpeg" | "audio/mp3" | "audio/aac"
    );
    if !supported_mime {
        return Err(format!("Unsupported microphone audio format: {mime_type}"));
    }
    if audio_base64.len() > 12_000_000 {
        return Err("Voice recording is too long. Please keep it under 15 seconds.".into());
    }
    let audio = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|_| "Could not read the microphone recording.".to_string())?;
    if audio.is_empty() {
        return Err("No speech was recorded. Please try again.".into());
    }

    let key = read_api_key()?;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    );
    let body = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [
                {"text": "Transcribe the speech in this short audio clip. Preserve the language that was spoken. Return only the transcript, with no explanation. If no intelligible speech is present, return an empty string."},
                {"inline_data": {"mime_type": mime_type, "data": audio_base64}}
            ]
        }],
        "generationConfig": {"temperature": 0.0}
    });
    let response = reqwest::Client::new()
        .post(url)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Gemini for transcription: {e}"))?;
    let status = response.status();
    let payload: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Gemini returned an unreadable transcription response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| format!("Gemini API error ({status}).")));
    }
    payload
        .candidates
        .and_then(|items| items.into_iter().next())
        .and_then(|candidate| candidate.content)
        .and_then(|content| content.parts)
        .and_then(|parts| parts.into_iter().find_map(|part| part.text))
        .map(|text| text.trim().to_string())
        .ok_or_else(|| "Gemini could not transcribe that recording. Please try again.".to_string())
}

#[tauri::command]
pub async fn assistant_create_live_token() -> Result<String, String> {
    let key = read_api_key()?;
    let model = "models/gemini-3.8-live";
    let voice_config = serde_json::json!({
        "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Aoede"}}
    });
    let system_instruction = serde_json::json!({
        "parts": [{"text": "You are Lulu, the user's friendly desktop voice assistant. Have a natural, concise spoken conversation. Respond in the language the user speaks, especially Bengali or English. Keep spoken replies clear and reasonably short. For every current or time-sensitive question, including sports fixtures and schedules, you MUST call web_search before answering. After receiving web_search results, summarize them in the user's language; never claim you cannot browse or invent a technical problem. If the tool returns an error, tell the user its exact message. Use set_volume for Windows master output sound. Use open_url only when the user asks to open a website. Use diagnose_workspace for errors in the selected VS Code project. Use write_workspace_file only when the user explicitly asks to write code, and only at a relative path inside the selected project. Use launch_app when asked to launch an app, search_files to find files, and open_file to open a requested file. Never claim an action succeeded unless its tool reports success. Never invent file paths."}]
    });
    let tools = serde_json::json!([{
        "functionDeclarations": [
            {"name": "web_search", "description": "Search the public web for current facts, news, sports fixtures, schedules, and other time-sensitive information.", "parameters": {"type": "OBJECT", "properties": {"query": {"type": "STRING", "description": "Search question"}}, "required": ["query"]}},
            {"name": "open_url", "description": "Open a public website in the user's browser when explicitly requested.", "parameters": {"type": "OBJECT", "properties": {"url": {"type": "STRING", "description": "Absolute http or https URL"}}, "required": ["url"]}},
            {"name": "set_volume", "description": "Set Windows master output volume from 0 (muted) to 100.", "parameters": {"type": "OBJECT", "properties": {"volume": {"type": "INTEGER", "description": "Volume percentage from 0 to 100"}}, "required": ["volume"]}},
            {"name": "diagnose_workspace", "description": "Run the selected project's existing npm build script or cargo check to locate errors.", "parameters": {"type": "OBJECT", "properties": {}}},
            {"name": "write_workspace_file", "description": "Write code to a relative path in the selected VS Code project when the user explicitly asks.", "parameters": {"type": "OBJECT", "properties": {"path": {"type": "STRING"}, "content": {"type": "STRING"}}, "required": ["path", "content"]}},
            {"name": "launch_app", "description": "Launch an installed application requested by the user.", "parameters": {"type": "OBJECT", "properties": {"name": {"type": "STRING", "description": "App name"}}, "required": ["name"]}},
            {"name": "search_files", "description": "Search the user's Desktop, Downloads, Documents, Pictures, Music, and Videos by name.", "parameters": {"type": "OBJECT", "properties": {"query": {"type": "STRING", "description": "Filename or search words"}}, "required": ["query"]}},
            {"name": "open_file", "description": "Find a requested file and open it with its default Windows app when the match is unambiguous.", "parameters": {"type": "OBJECT", "properties": {"query": {"type": "STRING", "description": "Filename or search words"}}, "required": ["query"]}}
        ]
    }]);
    // The Live API AuthToken resource accepts bidiGenerateContentSetup directly.
    let body = serde_json::json!({
        "uses": 1,
        "bidiGenerateContentSetup": {
            "model": model,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": voice_config
            },
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
            "sessionResumption": {},
            "systemInstruction": system_instruction,
            "tools": tools
        }
    });
    let response = reqwest::Client::new()
        .post("https://generativelanguage.googleapis.com/v1beta/auth_tokens")
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not request a secure voice session: {e}"))?;
    let status = response.status();
    let token: LiveTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Google returned an unreadable voice-session response: {e}"))?;
    if !status.is_success() {
        return Err(token
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| format!("Gemini Live API error ({status}).")));
    }
    token
        .name
        .ok_or_else(|| "Google did not return a Live API token.".to_string())
}
