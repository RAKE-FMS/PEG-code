import { formatNumber } from "./format";
import { cloneVector, subtractVector } from "./math";
import type { MotionState, ToolpathDocument, Vector3Like } from "./types";

const TOKEN_PATTERN = /([GMTXYZEF])\s*(-?\d+(?:\.\d+)?)/gi;

export type SerializedGcodeLine = {
  lineNumber: number;
  text: string;
  kind: "raw" | "motion" | "trailing";
  segmentId?: string;
  nodeId?: string;
  relatedNodeIds: string[];
  relatedSegmentIds: string[];
};

function applyRawLineToState(state: MotionState, rawLine: string): void {
  const [body] = rawLine.split(";");
  const trimmedBody = body.trim();

  if (trimmedBody.length === 0) {
    return;
  }

  let code: string | null = null;
  const values: Partial<Record<"X" | "Y" | "Z" | "E" | "F", number>> = {};

  for (const match of trimmedBody.matchAll(TOKEN_PATTERN)) {
    const key = match[1].toUpperCase();
    const numericValue = Number.parseFloat(match[2]);

    if (key === "G" || key === "M") {
      code = `${key}${match[2]}`;
      continue;
    }

    if (key === "X" || key === "Y" || key === "Z" || key === "E" || key === "F") {
      values[key] = numericValue;
    }
  }

  if (code === "G90") state.xyzMode = "absolute";
  if (code === "G91") state.xyzMode = "relative";
  if (code === "M82") state.eMode = "absolute";
  if (code === "M83") state.eMode = "relative";

  if (code === "G92") {
    if (values.X !== undefined) state.position.x = values.X;
    if (values.Y !== undefined) state.position.y = values.Y;
    if (values.Z !== undefined) state.position.z = values.Z;
    if (values.E !== undefined) state.extrusionAccumulator = values.E;
    if (values.F !== undefined) state.feedrate = values.F;
  }

  if ((code === "G0" || code === "G1") && values.F !== undefined) {
    state.feedrate = values.F;
  }

  if ((code === "G0" || code === "G1") && values.E !== undefined) {
    state.extrusionAccumulator =
      state.eMode === "absolute"
        ? values.E
        : state.extrusionAccumulator + values.E;
  }
}

function formatVectorForMode(
  position: Vector3Like,
  nextPosition: Vector3Like,
  mode: MotionState["xyzMode"]
): Vector3Like {
  if (mode === "absolute") {
    return nextPosition;
  }

  return subtractVector(nextPosition, position);
}

export function serializeGcode(document: ToolpathDocument): SerializedGcodeLine[] {
  const lines: SerializedGcodeLine[] = [];
  const state: MotionState = {
    position: { x: 0, y: 0, z: 0 },
    feedrate: 1800,
    extrusionAccumulator: 0,
    xyzMode: "absolute",
    eMode: "absolute"
  };

  function pushLine(line: Omit<SerializedGcodeLine, "lineNumber">): void {
    lines.push({
      ...line,
      lineNumber: lines.length + 1
    });
  }

  for (const segment of document.segments) {
    for (const rawLine of segment.leadingRawLines) {
      pushLine({
        text: rawLine,
        kind: "raw",
        relatedNodeIds: [],
        relatedSegmentIds: []
      });
      applyRawLineToState(state, rawLine);
    }

    const endPosition = cloneVector(document.nodes[segment.endNodeId].position);
    const commandParts = [segment.isTravel ? "G0" : "G1"];
    const commandPosition = formatVectorForMode(state.position, endPosition, state.xyzMode);

    commandParts.push(`X${formatNumber(commandPosition.x)}`);
    commandParts.push(`Y${formatNumber(commandPosition.y)}`);
    commandParts.push(`Z${formatNumber(commandPosition.z)}`);

    if (!segment.isTravel) {
      const nextE =
        state.eMode === "absolute"
          ? state.extrusionAccumulator + segment.extrusion
          : segment.extrusion;
      commandParts.push(`E${formatNumber(nextE)}`);
      state.extrusionAccumulator += segment.extrusion;
    }

    if (segment.feedrate !== state.feedrate) {
      commandParts.push(`F${formatNumber(segment.feedrate)}`);
      state.feedrate = segment.feedrate;
    }

    const suffix = segment.inlineComment ? ` ; ${segment.inlineComment}` : "";

    pushLine({
      text: `${commandParts.join(" ")}${suffix}`,
      kind: "motion",
      segmentId: segment.id,
      nodeId: segment.endNodeId,
      relatedNodeIds: [segment.startNodeId, segment.endNodeId],
      relatedSegmentIds: [segment.id]
    });

    state.position = endPosition;
  }

  for (const rawLine of document.trailingRawLines) {
    pushLine({
      text: rawLine,
      kind: "trailing",
      relatedNodeIds: [],
      relatedSegmentIds: []
    });
  }

  return lines;
}
