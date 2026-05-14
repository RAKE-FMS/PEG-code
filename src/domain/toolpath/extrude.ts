import { distanceBetween } from "./math";
import type { ToolpathDocument, Vector3Like } from "./types";

const MIN_DISTANCE = 0.0001;

function createExtrudedNodeId(document: ToolpathDocument): string {
  return `node-${Object.keys(document.nodes).length}`;
}

function createExtrudedSegmentId(document: ToolpathDocument): string {
  return `segment-${document.segments.length}`;
}

function inferFeedrate(document: ToolpathDocument, nodeId: string): number {
  const lastAttached = [...document.segments]
    .reverse()
    .find((segment) => segment.startNodeId === nodeId || segment.endNodeId === nodeId);

  return lastAttached?.feedrate ?? 1800;
}

export function extrudeFromNode(
  document: ToolpathDocument,
  nodeId: string,
  targetPosition: Vector3Like
): ToolpathDocument {
  const sourceNode = document.nodes[nodeId];
  if (!sourceNode) {
    return document;
  }

  const segmentLength = distanceBetween(sourceNode.position, targetPosition);
  if (segmentLength < MIN_DISTANCE) {
    return document;
  }

  const nextNodeId = createExtrudedNodeId(document);
  const nextSegmentId = createExtrudedSegmentId(document);
  const inheritedFeedrate = inferFeedrate(document, nodeId);
  const extrusionAmount = segmentLength * document.metadata.extrusionPerMm;

  return {
    ...document,
    nodes: {
      ...document.nodes,
      [nextNodeId]: {
        id: nextNodeId,
        position: { ...targetPosition }
      }
    },
    segments: [
      ...document.segments,
      {
        id: nextSegmentId,
        startNodeId: nodeId,
        endNodeId: nextNodeId,
        extrusion: extrusionAmount,
        feedrate: inheritedFeedrate,
        isTravel: false,
        command: "G1",
        leadingRawLines: [],
        source: "extruded"
      }
    ]
  };
}

