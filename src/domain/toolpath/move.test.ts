import { moveNodesByOffset } from "./move";
import { parseGcode } from "./parseGcode";

describe("moveNodesByOffset", () => {
  it("moves the selected vertex and recalculates attached extrusion lengths", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G1 X10 Y0 Z0.2 E1 F1800",
      "G1 X20 Y0 Z0.2 E2 F1800"
    ].join("\n"));

    const nodeId = document.segments[0].endNodeId;
    const nextDocument = moveNodesByOffset(document, [nodeId], {
      x: 0,
      y: 10,
      z: 0
    });

    expect(nextDocument.nodes[nodeId]?.position).toEqual({
      x: 10,
      y: 10,
      z: 0.2
    });
    expect(nextDocument.segments[0].extrusion).toBeGreaterThan(document.segments[0].extrusion);
    expect(nextDocument.segments[1].extrusion).toBeGreaterThan(document.segments[1].extrusion);
  });

  it("updates all selected vertices with the same offset", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G1 X10 Y0 Z0.2 E1 F1800"
    ].join("\n"));

    const segment = document.segments[0];
    const nextDocument = moveNodesByOffset(document, [segment.startNodeId, segment.endNodeId], {
      x: 1,
      y: -2,
      z: 0.5
    });

    expect(nextDocument.nodes[segment.startNodeId]?.position).toEqual({
      x: 1,
      y: -2,
      z: 0.5
    });
    expect(nextDocument.nodes[segment.endNodeId]?.position).toEqual({
      x: 11,
      y: -2,
      z: 0.7
    });
    expect(nextDocument.segments[0].extrusion).toBe(document.segments[0].extrusion);
  });
});
