import { exportGcode } from "./exportGcode";
import { extrudeFromNode } from "./extrude";
import { parseGcode } from "./parseGcode";

describe("exportGcode", () => {
  it("round-trips raw commands and comments", () => {
    const source = [
      "; header",
      "G90",
      "M82",
      "G92 E0",
      "G0 X10 Y10 Z0.2 F3000",
      "M106 S255",
      "G1 X15 Y10 Z0.2 E1.2 F1800 ; wall"
    ].join("\n");

    const document = parseGcode(source);
    const exported = exportGcode(document);

    expect(exported).toContain("; header");
    expect(exported).toContain("M106 S255");
    expect(exported).toContain("; wall");
  });

  it("exports new extruded segments in order", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G0 X0 Y0 Z0.2",
      "G1 X10 Y0 Z0.2 E1",
      "G1 X20 Y0 Z0.2 E2"
    ].join("\n"));

    const sourceNodeId = document.segments[1].endNodeId;
    const nextDocument = extrudeFromNode(document, sourceNodeId, { x: 10, y: 10, z: 4 });
    const exported = exportGcode(nextDocument);

    const lines = exported.split("\n");
    const insertedIndex = lines.findIndex((line) => line.includes("G1 X10 Y10 Z4"));
    const followingIndex = lines.findIndex((line) => line.includes("G1 X20 Y0 Z0.2"));

    expect(insertedIndex).toBeGreaterThan(-1);
    expect(followingIndex).toBe(insertedIndex + 1);
  });
});
