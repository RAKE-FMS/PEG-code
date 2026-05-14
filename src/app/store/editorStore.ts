import { create } from "zustand";
import { addVector, cloneVector, distanceBetween } from "../../domain/toolpath/math";
import { extrudeFromNode } from "../../domain/toolpath/extrude";
import { moveNodesByOffset } from "../../domain/toolpath/move";
import { parseGcode } from "../../domain/toolpath/parseGcode";
import { SAMPLE_GCODE } from "../../domain/toolpath/sample";
import type {
  SelectionState,
  ToolpathDocument,
  Vector3Like
} from "../../domain/toolpath/types";

export type HoverTarget =
  | { type: "vertex"; id: string }
  | { type: "segment"; id: string }
  | null;

export type ExtrudeSession = {
  sourceNodeId: string;
  planeNormal: Vector3Like;
  previewPosition: Vector3Like;
};

export type AxisLock = "x" | "y" | "z" | null;

export type TransformSession = {
  mode: "move" | "extrude";
  nodeIds: string[];
  sourceNodeId: string;
  planeNormal: Vector3Like;
  axisLock: AxisLock;
  previewOffset: Vector3Like;
  numericInput: string;
};

type EditorStore = {
  document: ToolpathDocument;
  sourceName: string;
  statusMessage: string;
  selection: SelectionState;
  hoverTarget: HoverTarget;
  activeTool: "select" | "move" | "extrude";
  extrudeSession: ExtrudeSession | null;
  transformSession: TransformSession | null;
  loadDocument: (gcodeText: string, sourceName?: string) => void;
  setStatusMessage: (message: string) => void;
  setHoverTarget: (target: HoverTarget) => void;
  clearHoverTarget: () => void;
  clearSelection: () => void;
  selectVertex: (id: string, additive?: boolean) => void;
  selectSegment: (id: string, additive?: boolean) => void;
  beginMove: (planeNormal: Vector3Like) => void;
  beginExtrude: (planeNormal: Vector3Like) => void;
  setTransformAxisLock: (axisLock: AxisLock) => void;
  updateTransformPreview: (offset: Vector3Like) => void;
  appendTransformNumericInput: (character: string) => void;
  backspaceTransformNumericInput: () => void;
  cancelTransform: () => void;
  confirmTransform: () => void;
};

const initialDocument = parseGcode(SAMPLE_GCODE, "sample.gcode");

function toggleId(currentIds: string[], id: string): string[] {
  return currentIds.includes(id)
    ? currentIds.filter((currentId) => currentId !== id)
    : [...currentIds, id];
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function getSegmentEndpointIds(document: ToolpathDocument, segmentIds: string[]): string[] {
  return uniqueIds(
    segmentIds.flatMap((segmentId) => {
      const segment = document.segments.find((candidate) => candidate.id === segmentId);
      return segment ? [segment.startNodeId, segment.endNodeId] : [];
    })
  );
}

function getStandaloneVertexIds(
  document: ToolpathDocument,
  currentVertexIds: string[],
  currentSegmentIds: string[]
): string[] {
  const segmentVertexIds = new Set(getSegmentEndpointIds(document, currentSegmentIds));
  return currentVertexIds.filter((vertexId) => !segmentVertexIds.has(vertexId));
}

function getCoincidentVertexIds(document: ToolpathDocument, vertexIds: string[]): string[] {
  const coincidentVertexIds = new Set(vertexIds);

  for (const vertexId of vertexIds) {
    const sourceNode = document.nodes[vertexId];
    if (!sourceNode) {
      continue;
    }

    for (const candidateNode of Object.values(document.nodes)) {
      if (distanceBetween(sourceNode.position, candidateNode.position) < 0.0001) {
        coincidentVertexIds.add(candidateNode.id);
      }
    }
  }

  return [...coincidentVertexIds];
}

function formatTransformStatus(session: TransformSession): string {
  const axisLabel = session.axisLock ? session.axisLock.toUpperCase() : "free";
  const amountLabel = session.numericInput.length > 0 ? ` amount ${session.numericInput}mm` : "";
  return `${session.mode === "move" ? "Move" : "Extrude"} active (${axisLabel}${amountLabel}).`;
}

function toPreviewPosition(document: ToolpathDocument, session: TransformSession): Vector3Like | null {
  const sourceNode = document.nodes[session.sourceNodeId];
  if (!sourceNode) {
    return null;
  }

  return addVector(sourceNode.position, session.previewOffset);
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  document: initialDocument,
  sourceName: "sample.gcode",
  statusMessage: "Ready. Open a G-code file or start exploring the sample path.",
  selection: {
    vertexIds: [],
    segmentIds: []
  },
  hoverTarget: null,
  activeTool: "select",
  extrudeSession: null,
  transformSession: null,
  loadDocument: (gcodeText, sourceName = "untitled.gcode") => {
    set({
      document: parseGcode(gcodeText, sourceName),
      sourceName,
      activeTool: "select",
      extrudeSession: null,
      transformSession: null,
      selection: { vertexIds: [], segmentIds: [] },
      hoverTarget: null,
      statusMessage: `Loaded ${sourceName}`
    });
  },
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setHoverTarget: (hoverTarget) => set({ hoverTarget }),
  clearHoverTarget: () => set({ hoverTarget: null }),
  clearSelection: () =>
    set({
      selection: { vertexIds: [], segmentIds: [] },
      activeTool: "select",
      extrudeSession: null,
      transformSession: null
    }),
  selectVertex: (id, additive = false) =>
    set((state) => ({
      selection: {
        vertexIds: additive ? toggleId(state.selection.vertexIds, id) : [id],
        segmentIds: additive ? state.selection.segmentIds : []
      },
      activeTool: "select",
      extrudeSession: null,
      transformSession: null
    })),
  selectSegment: (id, additive = false) =>
    set((state) => {
      const nextSegmentIds = additive ? toggleId(state.selection.segmentIds, id) : [id];
      const standaloneVertexIds = additive
        ? getStandaloneVertexIds(state.document, state.selection.vertexIds, state.selection.segmentIds)
        : [];

      return {
        selection: {
          vertexIds: uniqueIds([
            ...standaloneVertexIds,
            ...getSegmentEndpointIds(state.document, nextSegmentIds)
          ]),
          segmentIds: nextSegmentIds
        },
        activeTool: "select",
        extrudeSession: null,
        transformSession: null
      };
    }),
  beginMove: (planeNormal) => {
    const state = get();
    if (state.selection.vertexIds.length === 0) {
      set({ statusMessage: "Select at least one vertex before using Move." });
      return;
    }

    const sourceNodeId = state.selection.vertexIds[0];
    const nodeIds = getCoincidentVertexIds(state.document, state.selection.vertexIds);
    set({
      activeTool: "move",
      extrudeSession: null,
      transformSession: {
        mode: "move",
        nodeIds,
        sourceNodeId,
        planeNormal,
        axisLock: null,
        previewOffset: { x: 0, y: 0, z: 0 },
        numericInput: ""
      },
      statusMessage: "Move active. Move the pointer, lock an axis with X/Y/Z, or type a distance in mm."
    });
  },
  beginExtrude: (planeNormal) => {
    const state = get();
    const sourceNodeId = state.selection.vertexIds[0];
    if (!sourceNodeId) {
      set({ statusMessage: "Select a vertex before using Extrude." });
      return;
    }

    const sourceNode = state.document.nodes[sourceNodeId];
    if (!sourceNode) {
      return;
    }

    set({
      activeTool: "extrude",
      transformSession: {
        mode: "extrude",
        nodeIds: [sourceNodeId],
        sourceNodeId,
        planeNormal,
        axisLock: null,
        previewOffset: { x: 0, y: 0, z: 0 },
        numericInput: ""
      },
      extrudeSession: {
        sourceNodeId,
        planeNormal,
        previewPosition: { ...sourceNode.position }
      },
      statusMessage: "Extrude active. Move the pointer, lock an axis with X/Y/Z, or type a distance in mm."
    });
  },
  setTransformAxisLock: (axisLock) =>
    set((state) => ({
      transformSession: state.transformSession
        ? {
            ...state.transformSession,
            axisLock
          }
        : null,
      statusMessage: state.transformSession
        ? formatTransformStatus({
            ...state.transformSession,
            axisLock
          })
        : state.statusMessage
    })),
  updateTransformPreview: (previewOffset) =>
    set((state) => {
      if (!state.transformSession) {
        return { extrudeSession: null };
      }

      if (state.transformSession.numericInput.length > 0) {
        return {};
      }

      const nextTransformSession = {
        ...state.transformSession,
        previewOffset
      };
      const previewPosition = toPreviewPosition(state.document, nextTransformSession);

      return {
        transformSession: nextTransformSession,
        extrudeSession:
          nextTransformSession.mode === "extrude" && previewPosition
            ? {
                sourceNodeId: nextTransformSession.sourceNodeId,
                planeNormal: nextTransformSession.planeNormal,
                previewPosition
              }
            : null
      };
    }),
  appendTransformNumericInput: (character) =>
    set((state) => {
      const session = state.transformSession;
      if (!session) {
        return {};
      }

      const nextNumericInput = `${session.numericInput}${character}`;
      const parsedAmount = Number(nextNumericInput);
      const hasNumericValue =
        nextNumericInput !== "-" &&
        nextNumericInput !== "." &&
        nextNumericInput !== "-." &&
        Number.isFinite(parsedAmount);
      const axisLock = session.axisLock ?? "x";
      const nextPreviewOffset =
        hasNumericValue
          ? {
              x: axisLock === "x" ? parsedAmount : 0,
              y: axisLock === "y" ? parsedAmount : 0,
              z: axisLock === "z" ? parsedAmount : 0
            }
          : session.previewOffset;
      const nextTransformSession = {
        ...session,
        axisLock,
        numericInput: nextNumericInput,
        previewOffset: nextPreviewOffset
      };
      const previewPosition = toPreviewPosition(state.document, nextTransformSession);

      return {
        transformSession: nextTransformSession,
        extrudeSession:
          nextTransformSession.mode === "extrude" && previewPosition
            ? {
                sourceNodeId: nextTransformSession.sourceNodeId,
                planeNormal: nextTransformSession.planeNormal,
                previewPosition
              }
            : null,
        statusMessage: formatTransformStatus(nextTransformSession)
      };
    }),
  backspaceTransformNumericInput: () =>
    set((state) => {
      const session = state.transformSession;
      if (!session) {
        return {};
      }

      const nextNumericInput = session.numericInput.slice(0, -1);
      const parsedAmount = Number(nextNumericInput);
      const hasNumericValue =
        nextNumericInput !== "" &&
        nextNumericInput !== "-" &&
        nextNumericInput !== "." &&
        nextNumericInput !== "-." &&
        Number.isFinite(parsedAmount);
      const nextPreviewOffset =
        hasNumericValue && session.axisLock
          ? {
              x: session.axisLock === "x" ? parsedAmount : 0,
              y: session.axisLock === "y" ? parsedAmount : 0,
              z: session.axisLock === "z" ? parsedAmount : 0
            }
          : { x: 0, y: 0, z: 0 };
      const nextTransformSession = {
        ...session,
        numericInput: nextNumericInput,
        previewOffset: nextPreviewOffset
      };
      const previewPosition = toPreviewPosition(state.document, nextTransformSession);

      return {
        transformSession: nextTransformSession,
        extrudeSession:
          nextTransformSession.mode === "extrude" && previewPosition
            ? {
                sourceNodeId: nextTransformSession.sourceNodeId,
                planeNormal: nextTransformSession.planeNormal,
                previewPosition
              }
            : null,
        statusMessage: formatTransformStatus(nextTransformSession)
      };
    }),
  cancelTransform: () =>
    set({
      activeTool: "select",
      extrudeSession: null,
      transformSession: null,
      statusMessage: "Transform cancelled."
    }),
  confirmTransform: () => {
    const state = get();
    if (!state.transformSession) {
      return;
    }

    if (state.transformSession.mode === "move") {
      const nextDocument = moveNodesByOffset(
        state.document,
        state.transformSession.nodeIds,
        cloneVector(state.transformSession.previewOffset)
      );

      set({
        document: nextDocument,
        activeTool: "select",
        extrudeSession: null,
        transformSession: null,
        statusMessage: "Move committed."
      });
      return;
    }

    const previewPosition = toPreviewPosition(state.document, state.transformSession);
    if (!previewPosition) {
      return;
    }

    const nextDocument = extrudeFromNode(
      state.document,
      state.transformSession.sourceNodeId,
      previewPosition
    );
    const nextNodeId = `node-${Object.keys(nextDocument.nodes).length - 1}`;

    set({
      document: nextDocument,
      activeTool: "select",
      extrudeSession: null,
      transformSession: null,
      selection: {
        vertexIds: [nextNodeId],
        segmentIds: []
      },
      statusMessage: "Extrude committed."
    });
  }
}));
