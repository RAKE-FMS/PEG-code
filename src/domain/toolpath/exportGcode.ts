import type { ToolpathDocument } from "./types";
import { serializeGcode } from "./serializeGcode";

export function exportGcode(document: ToolpathDocument): string {
  return serializeGcode(document)
    .map((line) => line.text)
    .join("\n");
}
