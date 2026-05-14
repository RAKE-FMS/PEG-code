use std::fs;

#[tauri::command]
fn open_gcode_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_gcode_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_gcode_file, save_gcode_file])
        .run(tauri::generate_context!())
        .expect("error while running PEG-code");
}
