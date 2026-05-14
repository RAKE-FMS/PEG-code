import { parseGcode } from "./parseGcode";

describe("parseGcode", () => {
  it("parses G0/G1 motion into segments and colors travel vs extrusion", () => {
    const document = parseGcode([
      "G90",
      "M82",
      "G0 X10 Y0 Z0.2 F3000",
      "G1 X20 Y0 Z0.2 E1.5 F1800"
    ].join("\n"));

    expect(document.segments).toHaveLength(2);
    expect(document.segments[0].isTravel).toBe(true);
    expect(document.segments[1].isTravel).toBe(false);
    expect(document.segments[1].extrusion).toBeCloseTo(1.5, 5);
  });

  it("supports relative XYZ and relative E motion", () => {
    const document = parseGcode([
      "G91",
      "M83",
      "G1 X10 E0.5 F1200",
      "G1 X5 E0.25"
    ].join("\n"));

    expect(document.segments).toHaveLength(2);
    expect(document.nodes[document.segments[1].endNodeId].position.x).toBeCloseTo(15, 5);
    expect(document.segments[0].extrusion).toBeCloseTo(0.5, 5);
    expect(document.segments[1].extrusion).toBeCloseTo(0.25, 5);
  });

  it("preserves comments and unknown commands as raw lines", () => {
    const document = parseGcode([
      "; start",
      "M104 S200",
      "G0 X1 Y2 Z3 ; move"
    ].join("\n"));

    expect(document.segments[0].leadingRawLines).toEqual(["; start", "M104 S200"]);
    expect(document.segments[0].inlineComment).toBe("move");
  });
});

