import { act } from "react";
import { useEditorStore } from "./editorStore";

describe("editorStore", () => {
  afterEach(() => {
    act(() => {
      useEditorStore.getState().loadDocument("G90\nM82\nG1 X10 Y0 Z0.2 E1 F1800", "test.gcode");
      useEditorStore.getState().clearSelection();
    });
  });

  it("supports additive selection for vertices", () => {
    const segment = useEditorStore.getState().document.segments[0];

    act(() => {
      useEditorStore.getState().selectVertex(segment.startNodeId, false);
      useEditorStore.getState().selectVertex(segment.endNodeId, true);
    });

    expect(useEditorStore.getState().selection.vertexIds).toEqual([
      segment.startNodeId,
      segment.endNodeId
    ]);
  });

  it("begins and confirms extrude from a selected vertex", () => {
    const segment = useEditorStore.getState().document.segments[0];

    act(() => {
      useEditorStore.getState().selectVertex(segment.endNodeId, false);
      useEditorStore.getState().beginExtrude({ x: 0, y: 0, z: 1 });
      useEditorStore.getState().updateExtrudePreview({ x: 10, y: 5, z: 2 });
      useEditorStore.getState().confirmExtrude();
    });

    expect(useEditorStore.getState().document.segments).toHaveLength(2);
    expect(useEditorStore.getState().activeTool).toBe("select");
  });
});

