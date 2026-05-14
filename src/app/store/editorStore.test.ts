import { act } from "react";
import { useEditorStore } from "./editorStore";

const TEST_GCODE = "G90\nM82\nG1 X10 Y0 Z0.2 E1 F1800\nG1 X20 Y0 Z0.2 E2 F1800";

describe("editorStore", () => {
  function resetStore(): void {
    act(() => {
      useEditorStore.getState().loadDocument(TEST_GCODE, "test.gcode");
      useEditorStore.getState().clearSelection();
    });
  }

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
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
      useEditorStore.getState().updateTransformPreview({ x: 0, y: 5, z: 1.8 });
      useEditorStore.getState().confirmTransform();
    });

    expect(useEditorStore.getState().document.segments).toHaveLength(3);
    expect(useEditorStore.getState().activeTool).toBe("select");
  });

  it("supports move mode with axis-locked numeric input", () => {
    const segment = useEditorStore.getState().document.segments[0];

    act(() => {
      useEditorStore.getState().selectVertex(segment.endNodeId, false);
      useEditorStore.getState().beginMove({ x: 0, y: 0, z: 1 });
      useEditorStore.getState().setTransformAxisLock("x");
      useEditorStore.getState().appendTransformNumericInput("-");
      useEditorStore.getState().appendTransformNumericInput(".");
      useEditorStore.getState().appendTransformNumericInput("1");
      useEditorStore.getState().confirmTransform();
    });

    expect(useEditorStore.getState().document.nodes[segment.endNodeId]?.position.x).toBeCloseTo(9.9);
    expect(useEditorStore.getState().activeTool).toBe("select");
  });

  it("keeps the first typed numeric value even if pointer preview updates arrive afterward", () => {
    const segment = useEditorStore.getState().document.segments[0];

    act(() => {
      useEditorStore.getState().selectVertex(segment.endNodeId, false);
      useEditorStore.getState().beginMove({ x: 0, y: 0, z: 1 });
      useEditorStore.getState().setTransformAxisLock("x");
      useEditorStore.getState().appendTransformNumericInput("1");
      useEditorStore.getState().updateTransformPreview({ x: 4, y: 0, z: 0 });
      useEditorStore.getState().confirmTransform();
    });

    expect(useEditorStore.getState().document.nodes[segment.endNodeId]?.position.x).toBeCloseTo(11);
  });

  it("selects both endpoint vertices when selecting a segment", () => {
    const segment = useEditorStore.getState().document.segments[0];

    act(() => {
      useEditorStore.getState().selectSegment(segment.id, false);
    });

    expect(useEditorStore.getState().selection.segmentIds).toEqual([segment.id]);
    expect(useEditorStore.getState().selection.vertexIds).toEqual([
      segment.startNodeId,
      segment.endNodeId
    ]);
  });

  it("keeps endpoint vertices in sync for additive segment selection", () => {
    const [firstSegment, secondSegment] = useEditorStore.getState().document.segments;

    act(() => {
      useEditorStore.getState().selectSegment(firstSegment.id, false);
      useEditorStore.getState().selectSegment(secondSegment.id, true);
    });

    expect(useEditorStore.getState().selection.segmentIds).toEqual([
      firstSegment.id,
      secondSegment.id
    ]);
    expect(useEditorStore.getState().selection.vertexIds).toEqual([
      firstSegment.startNodeId,
      firstSegment.endNodeId,
      secondSegment.startNodeId,
      secondSegment.endNodeId
    ]);
  });
});
