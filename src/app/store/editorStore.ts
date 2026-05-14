import { create } from "zustand";
import { extrudeFromNode } from "../../domain/toolpath/extrude";
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

type EditorStore = {
  document: ToolpathDocument;
  sourceName: string;
  statusMessage: string;
  selection: SelectionState;
  hoverTarget: HoverTarget;
  activeTool: "select" | "extrude";
  extrudeSession: ExtrudeSession | null;
  loadDocument: (gcodeText: string, sourceName?: string) => void;
  setStatusMessage: (message: string) => void;
  setHoverTarget: (target: HoverTarget) => void;
  clearHoverTarget: () => void;
  clearSelection: () => void;
  selectVertex: (id: string, additive?: boolean) => void;
  selectSegment: (id: string, additive?: boolean) => void;
  beginExtrude: (planeNormal: Vector3Like) => void;
  updateExtrudePreview: (position: Vector3Like) => void;
  cancelExtrude: () => void;
  confirmExtrude: () => void;
};

const initialDocument = parseGcode(SAMPLE_GCODE, "sample.gcode");

function toggleId(currentIds: string[], id: string): string[] {
  return currentIds.includes(id)
    ? currentIds.filter((currentId) => currentId !== id)
    : [...currentIds, id];
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
  loadDocument: (gcodeText, sourceName = "untitled.gcode") => {
    set({
      document: parseGcode(gcodeText, sourceName),
      sourceName,
      activeTool: "select",
      extrudeSession: null,
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
      extrudeSession: null
    }),
  selectVertex: (id, additive = false) =>
    set((state) => ({
      selection: {
        vertexIds: additive ? toggleId(state.selection.vertexIds, id) : [id],
        segmentIds: additive ? state.selection.segmentIds : []
      },
      activeTool: "select",
      extrudeSession: null
    })),
  selectSegment: (id, additive = false) =>
    set((state) => ({
      selection: {
        vertexIds: additive ? state.selection.vertexIds : [],
        segmentIds: additive ? toggleId(state.selection.segmentIds, id) : [id]
      },
      activeTool: "select",
      extrudeSession: null
    })),
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
      extrudeSession: {
        sourceNodeId,
        planeNormal,
        previewPosition: { ...sourceNode.position }
      },
      statusMessage: "Extrude active. Move the pointer in the viewport, then click to confirm."
    });
  },
  updateExtrudePreview: (previewPosition) =>
    set((state) => ({
      extrudeSession: state.extrudeSession
        ? {
            ...state.extrudeSession,
            previewPosition
          }
        : null
    })),
  cancelExtrude: () =>
    set({
      activeTool: "select",
      extrudeSession: null,
      statusMessage: "Extrude cancelled."
    }),
  confirmExtrude: () => {
    const state = get();
    if (!state.extrudeSession) {
      return;
    }

    const nextDocument = extrudeFromNode(
      state.document,
      state.extrudeSession.sourceNodeId,
      state.extrudeSession.previewPosition
    );
    const nextNodeId = `node-${Object.keys(nextDocument.nodes).length - 1}`;

    set({
      document: nextDocument,
      activeTool: "select",
      extrudeSession: null,
      selection: {
        vertexIds: [nextNodeId],
        segmentIds: []
      },
      statusMessage: "Extrude committed."
    });
  }
}));

