import { extrudeFromNode } from "./extrude";
import { parseGcode } from "./parseGcode";
import { serializeGcode } from "./serializeGcode";

describe("serializeGcode", () => {
  it("tracks line numbers and destination vertices for motion lines", () => {
    const document = parseGcode(
      ["; header", "G90", "M82", "G0 X0 Y0 Z0.2 F3000", "G1 X10 Y0 Z0.2 E1 F1800"].join("\n")
    );

    const lines = serializeGcode(document);
    const motionLines = lines.filter((line) => line.kind === "motion");

    expect(lines[0]).toMatchObject({ lineNumber: 1, text: "; header" });
    expect(motionLines[1]).toMatchObject({
      lineNumber: 5,
      segmentId: document.segments[1].id,
      nodeId: document.segments[1].endNodeId
    });
  });

  it("includes newly extruded geometry in the serialized lines", () => {
    const document = parseGcode(["G90", "M82", "G0 X0 Y0 Z0.2", "G1 X10 Y0 Z0.2 E1"].join("\n"));
    const nextDocument = extrudeFromNode(document, document.segments[1].endNodeId, {
      x: 10,
      y: 10,
      z: 0.2
    });

    const lines = serializeGcode(nextDocument);
    const motionLines = lines.filter((line) => line.kind === "motion");
    const lastMotionLine = motionLines[motionLines.length - 1];

    expect(lastMotionLine?.text).toContain("G1 X10 Y10 Z0.2");
    expect(lastMotionLine?.nodeId).toBe(`node-${Object.keys(nextDocument.nodes).length - 1}`);
  });
});
