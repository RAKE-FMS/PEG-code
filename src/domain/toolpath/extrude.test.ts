import { extrudeFromNode } from "./extrude";
import { parseGcode } from "./parseGcode";

describe("extrudeFromNode", () => {
  it("creates a new node and segment that inherit feedrate", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G1 X10 Y0 Z0.2 E1 F2222"
    ].join("\n"));

    const sourceNodeId = document.segments[0].endNodeId;
    const nextDocument = extrudeFromNode(document, sourceNodeId, {
      x: 10,
      y: 10,
      z: 1.2
    });

    expect(nextDocument.segments).toHaveLength(2);
    expect(nextDocument.segments[1].feedrate).toBe(2222);
    expect(nextDocument.segments[1].extrusion).toBeGreaterThan(0);
  });

  it("inserts an extrusion after a middle vertex and reroutes the following segment", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G1 X10 Y0 Z0.2 E1 F1800",
      "G1 X20 Y0 Z0.2 E2 F1800"
    ].join("\n"));

    const sourceNodeId = document.segments[0].endNodeId;
    const nextDocument = extrudeFromNode(document, sourceNodeId, {
      x: 10,
      y: 10,
      z: 0.2
    });

    expect(nextDocument.segments).toHaveLength(3);
    expect(nextDocument.segments[1]).toMatchObject({
      startNodeId: sourceNodeId,
      source: "extruded"
    });
    expect(nextDocument.segments[2].startNodeId).toBe(nextDocument.segments[1].endNodeId);
    expect(nextDocument.segments[2].extrusion).toBeGreaterThan(document.segments[1].extrusion);
  });
});
