type OpenFileResult = {
  path?: string;
  name: string;
  contents: string;
};

function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function inferFileName(path?: string): string {
  if (!path) {
    return "untitled.gcode";
  }

  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? "untitled.gcode";
}

function readFileThroughInput(): Promise<OpenFileResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gcode,.gc,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const contents = await file.text();
      resolve({
        name: file.name,
        contents
      });
    };
    input.click();
  });
}

export async function openGcodeFile(): Promise<OpenFileResult | null> {
  if (!isTauriEnvironment()) {
    return readFileThroughInput();
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const path = await open({
    title: "Open G-code",
    multiple: false,
    filters: [{ name: "G-code", extensions: ["gcode", "gc", "txt"] }]
  });

  if (!path || Array.isArray(path)) {
    return null;
  }

  const contents = await invoke<string>("open_gcode_file", { path });
  return {
    path,
    name: inferFileName(path),
    contents
  };
}

export async function saveGcodeFile(contents: string, defaultFileName: string): Promise<string | null> {
  if (!isTauriEnvironment()) {
    const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return defaultFileName;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const path = await save({
    title: "Export G-code",
    defaultPath: defaultFileName,
    filters: [{ name: "G-code", extensions: ["gcode"] }]
  });

  if (!path) {
    return null;
  }

  await invoke("save_gcode_file", { path, contents });
  return path;
}
