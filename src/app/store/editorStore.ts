import { create } from "zustand";
import { deleteNodes } from "../../domain/toolpath/delete";
import { exportGcode } from "../../domain/toolpath/exportGcode";
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

type EditorSnapshot = {
  document: ToolpathDocument;
  sourceName: string;
  selection: SelectionState;
};

type EditorStore = {
  document: ToolpathDocument;
  sourceName: string;
  gcodeDraft: string;
  isGcodeDirty: boolean;
  statusMessage: string;
  selection: SelectionState;
  hoverTarget: HoverTarget;
  activeTool: "select" | "move" | "extrude";
  extrudeSession: ExtrudeSession | null;
  transformSession: TransformSession | null;
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];
  loadDocument: (gcodeText: string, sourceName?: string) => void;
  setGcodeDraft: (gcodeText: string) => void;
  revertGcodeDraft: () => void;
  applyGcodeDraft: () => void;
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
  deleteSelectedVertices: () => void;
  undo: () => void;
  redo: () => void;
};

const initialDocument = parseGcode(SAMPLE_GCODE, "sample.gcode");
const initialGcodeDraft = SAMPLE_GCODE;

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

function cloneSelection(selection: SelectionState): SelectionState {
  return {
    vertexIds: [...selection.vertexIds],
    segmentIds: [...selection.segmentIds]
  };
}

function cloneDocument(document: ToolpathDocument): ToolpathDocument {
  return {
    nodes: Object.fromEntries(
      Object.entries(document.nodes).map(([nodeId, node]) => [
        nodeId,
        {
          ...node,
          position: { ...node.position }
        }
      ])
    ),
    segments: document.segments.map((segment) => ({
      ...segment,
      leadingRawLines: [...segment.leadingRawLines]
    })),
    trailingRawLines: [...document.trailingRawLines],
    metadata: {
      ...document.metadata
    }
  };
}

function createSnapshot(
  document: ToolpathDocument,
  selection: SelectionState,
  sourceName: string
): EditorSnapshot {
  return {
    document: cloneDocument(document),
    selection: cloneSelection(selection),
    sourceName
  };
}

function getSerializedDocumentText(document: ToolpathDocument): string {
  return exportGcode(document);
}

function selectionEquals(left: SelectionState, right: SelectionState): boolean {
  return (
    left.vertexIds.length === right.vertexIds.length &&
    left.segmentIds.length === right.segmentIds.length &&
    left.vertexIds.every((vertexId, index) => vertexId === right.vertexIds[index]) &&
    left.segmentIds.every((segmentId, index) => segmentId === right.segmentIds[index])
  );
}

function withHistory(
  state: EditorStore,
  nextState: Partial<EditorStore> & {
    document?: ToolpathDocument;
    selection?: SelectionState;
    sourceName?: string;
  }
): Partial<EditorStore> {
  const nextDocument = nextState.document ?? state.document;
  const nextSelection = nextState.selection ?? state.selection;
  const nextSourceName = nextState.sourceName ?? state.sourceName;

  if (nextDocument === state.document && selectionEquals(nextSelection, state.selection) && nextSourceName === state.sourceName) {
    return nextState;
  }

  return {
    ...nextState,
    undoStack: [...state.undoStack, createSnapshot(state.document, state.selection, state.sourceName)],
    redoStack: []
  };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  document: initialDocument,
  sourceName: "sample.gcode",
  gcodeDraft: initialGcodeDraft,
  isGcodeDirty: false,
  statusMessage: "Ready. Open a G-code file or start exploring the sample path.",
  selection: {
    vertexIds: [],
    segmentIds: []
  },
  hoverTarget: null,
  activeTool: "select",
  extrudeSession: null,
  transformSession: null,
  undoStack: [],
  redoStack: [],
  loadDocument: (gcodeText, sourceName = "untitled.gcode") => {
    set({
      document: parseGcode(gcodeText, sourceName),
      sourceName,
      gcodeDraft: gcodeText,
      isGcodeDirty: false,
      activeTool: "select",
      extrudeSession: null,
      transformSession: null,
      undoStack: [],
      redoStack: [],
      selection: { vertexIds: [], segmentIds: [] },
      hoverTarget: null,
      statusMessage: `Loaded ${sourceName}`
    });
  },
  setGcodeDraft: (gcodeDraft) =>
    set((state) => ({
      gcodeDraft,
      isGcodeDirty: gcodeDraft !== getSerializedDocumentText(state.document)
    })),
  revertGcodeDraft: () =>
    set((state) => ({
      gcodeDraft: getSerializedDocumentText(state.document),
      isGcodeDirty: false,
      statusMessage: "Reverted G-code edits."
    })),
  applyGcodeDraft: () =>
    set((state) => {
      const normalizedCurrentText = getSerializedDocumentText(state.document);
      if (state.gcodeDraft === normalizedCurrentText) {
        return {
          isGcodeDirty: false,
          statusMessage: "No G-code changes to apply."
        };
      }

      const nextDocument = parseGcode(state.gcodeDraft, state.sourceName);

      return {
        ...withHistory(state, {
          document: nextDocument,
          selection: { vertexIds: [], segmentIds: [] },
          activeTool: "select",
          extrudeSession: null,
          transformSession: null,
          hoverTarget: null,
          statusMessage: "Applied G-code edits."
        }),
        gcodeDraft: state.gcodeDraft,
        isGcodeDirty: false
      };
    }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setHoverTarget: (hoverTarget) => set({ hoverTarget }),
  clearHoverTarget: () => set({ hoverTarget: null }),
  clearSelection: () =>
    set((state) =>
      withHistory(state, {
        selection: { vertexIds: [], segmentIds: [] },
        activeTool: "select",
        extrudeSession: null,
        transformSession: null
      })
    ),
  selectVertex: (id, additive = false) =>
    set((state) =>
      withHistory(state, {
        selection: {
          vertexIds: additive ? toggleId(state.selection.vertexIds, id) : [id],
          segmentIds: additive ? state.selection.segmentIds : []
        },
        activeTool: "select",
        extrudeSession: null,
        transformSession: null
      })
    ),
  selectSegment: (id, additive = false) =>
    set((state) => {
      const nextSegmentIds = additive ? toggleId(state.selection.segmentIds, id) : [id];
      const standaloneVertexIds = additive
        ? getStandaloneVertexIds(state.document, state.selection.vertexIds, state.selection.segmentIds)
        : [];

      return withHistory(state, {
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
      });
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
        gcodeDraft: getSerializedDocumentText(nextDocument),
        isGcodeDirty: false,
        activeTool: "select",
        extrudeSession: null,
        transformSession: null,
        undoStack: [...state.undoStack, createSnapshot(state.document, state.selection, state.sourceName)],
        redoStack: [],
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
      gcodeDraft: getSerializedDocumentText(nextDocument),
      isGcodeDirty: false,
      activeTool: "select",
      extrudeSession: null,
      transformSession: null,
      undoStack: [...state.undoStack, createSnapshot(state.document, state.selection, state.sourceName)],
      redoStack: [],
      selection: {
        vertexIds: [nextNodeId],
        segmentIds: []
      },
      statusMessage: "Extrude committed."
    });
  },
  deleteSelectedVertices: () =>
    set((state) => {
      if (state.selection.vertexIds.length === 0) {
        return {
          statusMessage: "Select at least one vertex before deleting."
        };
      }

      const nextDocument = deleteNodes(state.document, uniqueIds(state.selection.vertexIds));
      if (nextDocument === state.document) {
        return {
          statusMessage: "No vertices were deleted."
        };
      }

      return withHistory(state, {
        document: nextDocument,
        gcodeDraft: getSerializedDocumentText(nextDocument),
        isGcodeDirty: false,
        selection: { vertexIds: [], segmentIds: [] },
        activeTool: "select",
        extrudeSession: null,
        transformSession: null,
        statusMessage:
          state.selection.vertexIds.length === 1 ? "Vertex deleted." : "Vertices deleted."
      });
    }),
  undo: () =>
    set((state) => {
      const previousSnapshot = state.undoStack[state.undoStack.length - 1];
      if (!previousSnapshot) {
        return {
          statusMessage: "Nothing to undo."
        };
      }

      return {
        document: cloneDocument(previousSnapshot.document),
        sourceName: previousSnapshot.sourceName,
        gcodeDraft: getSerializedDocumentText(previousSnapshot.document),
        isGcodeDirty: false,
        selection: cloneSelection(previousSnapshot.selection),
        activeTool: "select",
        extrudeSession: null,
        transformSession: null,
        hoverTarget: null,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, createSnapshot(state.document, state.selection, state.sourceName)],
        statusMessage: "Undo."
      };
    }),
  redo: () =>
    set((state) => {
      const nextSnapshot = state.redoStack[state.redoStack.length - 1];
      if (!nextSnapshot) {
        return {
          statusMessage: "Nothing to redo."
        };
      }

      return {
        document: cloneDocument(nextSnapshot.document),
        sourceName: nextSnapshot.sourceName,
        gcodeDraft: getSerializedDocumentText(nextSnapshot.document),
        isGcodeDirty: false,
        selection: cloneSelection(nextSnapshot.selection),
        activeTool: "select",
        extrudeSession: null,
        transformSession: null,
        hoverTarget: null,
        undoStack: [...state.undoStack, createSnapshot(state.document, state.selection, state.sourceName)],
        redoStack: state.redoStack.slice(0, -1),
        statusMessage: "Redo."
      };
    })
}));
