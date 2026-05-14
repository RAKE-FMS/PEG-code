export type Vector3Like = {
  x: number;
  y: number;
  z: number;
};

export type Node = {
  id: string;
  position: Vector3Like;
};

export type Segment = {
  id: string;
  startNodeId: string;
  endNodeId: string;
  extrusion: number;
  feedrate: number;
  isTravel: boolean;
  command: "G0" | "G1";
  leadingRawLines: string[];
  inlineComment?: string;
  source: "parsed" | "extruded";
};

export type SelectionState = {
  vertexIds: string[];
  segmentIds: string[];
};

export type MotionMode = "absolute" | "relative";

export type ToolpathDocument = {
  nodes: Record<string, Node>;
  segments: Segment[];
  trailingRawLines: string[];
  metadata: {
    sourceName?: string;
    xyzMode: MotionMode;
    eMode: MotionMode;
    extrusionPerMm: number;
  };
};

export type MotionState = {
  position: Vector3Like;
  feedrate: number;
  extrusionAccumulator: number;
  xyzMode: MotionMode;
  eMode: MotionMode;
};

