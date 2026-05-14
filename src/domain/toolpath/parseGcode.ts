import { distanceBetween } from "./math";
import type {
  MotionMode,
  MotionState,
  Node,
  Segment,
  ToolpathDocument,
  Vector3Like
} from "./types";

const TOKEN_PATTERN = /([GMTXYZEF])\s*(-?\d+(?:\.\d+)?)/gi;

type ParsedLine = {
  code: string | null;
  values: Partial<Record<"X" | "Y" | "Z" | "E" | "F", number>>;
  comment?: string;
};

function createNodeId(index: number): string {
  return `node-${index}`;
}

function createSegmentId(index: number): string {
  return `segment-${index}`;
}

function parseLine(rawLine: string): ParsedLine {
  const [body, ...commentParts] = rawLine.split(";");
  const trimmedBody = body.trim();
  const comment = commentParts.length > 0 ? commentParts.join(";").trim() : undefined;

  let code: string | null = null;
  const values: ParsedLine["values"] = {};

  const matches = trimmedBody.matchAll(TOKEN_PATTERN);
  for (const match of matches) {
    const key = match[1].toUpperCase();
    const numericValue = Number.parseFloat(match[2]);

    if (key === "G" || key === "M" || key === "T") {
      code = `${key}${match[2]}`;
      continue;
    }

    if (key === "X" || key === "Y" || key === "Z" || key === "E" || key === "F") {
      values[key] = numericValue;
    }
  }

  return { code, values, comment };
}

function applyPositionMode(currentValue: number, nextValue: number | undefined, mode: MotionMode): number {
  if (nextValue === undefined) {
    return currentValue;
  }

  return mode === "absolute" ? nextValue : currentValue + nextValue;
}

function updateModes(state: MotionState, code: string | null): void {
  if (code === "G90") {
    state.xyzMode = "absolute";
  }

  if (code === "G91") {
    state.xyzMode = "relative";
  }

  if (code === "M82") {
    state.eMode = "absolute";
  }

  if (code === "M83") {
    state.eMode = "relative";
  }
}

function applyG92(state: MotionState, values: ParsedLine["values"]): void {
  if (values.X !== undefined) state.position.x = values.X;
  if (values.Y !== undefined) state.position.y = values.Y;
  if (values.Z !== undefined) state.position.z = values.Z;
  if (values.E !== undefined) state.extrusionAccumulator = values.E;
  if (values.F !== undefined) state.feedrate = values.F;
}

export function parseGcode(text: string, sourceName?: string): ToolpathDocument {
  const nodes: Record<string, Node> = {};
  const segments: Segment[] = [];
  const rawBuffer: string[] = [];

  const state: MotionState = {
    position: { x: 0, y: 0, z: 0 },
    feedrate: 1800,
    extrusionAccumulator: 0,
    xyzMode: "absolute",
    eMode: "absolute"
  };

  let nodeIndex = 0;
  let segmentIndex = 0;
  let extrusionPerMmSamples: number[] = [];

  function ensureNode(position: Vector3Like): string {
    const id = createNodeId(nodeIndex++);
    nodes[id] = {
      id,
      position: { ...position }
    };
    return id;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      rawBuffer.push(rawLine);
      continue;
    }

    const parsed = parseLine(rawLine);
    updateModes(state, parsed.code);

    if (parsed.code === "G92") {
      applyG92(state, parsed.values);
      rawBuffer.push(rawLine);
      continue;
    }

    const isMotion = parsed.code === "G0" || parsed.code === "G1";
    if (!isMotion) {
      if (parsed.values.F !== undefined) {
        state.feedrate = parsed.values.F;
      }
      rawBuffer.push(rawLine);
      continue;
    }

    const command: "G0" | "G1" = parsed.code === "G0" ? "G0" : "G1";
    const nextPosition = {
      x: applyPositionMode(state.position.x, parsed.values.X, state.xyzMode),
      y: applyPositionMode(state.position.y, parsed.values.Y, state.xyzMode),
      z: applyPositionMode(state.position.z, parsed.values.Z, state.xyzMode)
    };

    const hasSpatialMove =
      nextPosition.x !== state.position.x ||
      nextPosition.y !== state.position.y ||
      nextPosition.z !== state.position.z;

    const nextFeedrate = parsed.values.F ?? state.feedrate;
    const nextExtrusionAccumulator =
      parsed.values.E === undefined
        ? state.extrusionAccumulator
        : state.eMode === "absolute"
          ? parsed.values.E
          : state.extrusionAccumulator + parsed.values.E;
    const extrusionDelta = nextExtrusionAccumulator - state.extrusionAccumulator;

    if (!hasSpatialMove) {
      state.feedrate = nextFeedrate;
      state.extrusionAccumulator = nextExtrusionAccumulator;
      rawBuffer.push(rawLine);
      continue;
    }

    const startNodeId = ensureNode(state.position);
    const endNodeId = ensureNode(nextPosition);
    const segmentLength = distanceBetween(state.position, nextPosition);

    if (extrusionDelta > 0 && segmentLength > 0) {
      extrusionPerMmSamples = [...extrusionPerMmSamples, extrusionDelta / segmentLength];
    }

    segments.push({
      id: createSegmentId(segmentIndex++),
      startNodeId,
      endNodeId,
      extrusion: Math.max(0, extrusionDelta),
      feedrate: nextFeedrate,
      isTravel: parsed.code === "G0" || extrusionDelta <= 0,
      command,
      leadingRawLines: [...rawBuffer],
      inlineComment: parsed.comment,
      source: "parsed"
    });

    rawBuffer.length = 0;
    state.position = nextPosition;
    state.feedrate = nextFeedrate;
    state.extrusionAccumulator = nextExtrusionAccumulator;
  }

  const averageExtrusionPerMm =
    extrusionPerMmSamples.length > 0
      ? extrusionPerMmSamples.reduce((sum, value) => sum + value, 0) / extrusionPerMmSamples.length
      : 0.045;

  return {
    nodes,
    segments,
    trailingRawLines: [...rawBuffer],
    metadata: {
      sourceName,
      xyzMode: state.xyzMode,
      eMode: state.eMode,
      extrusionPerMm: averageExtrusionPerMm
    }
  };
}
