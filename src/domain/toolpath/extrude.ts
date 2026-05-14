import { distanceBetween } from "./math";
import type { Segment, ToolpathDocument, Vector3Like } from "./types";

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

function positionsMatch(left: Vector3Like, right: Vector3Like): boolean {
  return distanceBetween(left, right) < MIN_DISTANCE;
}

function findInsertionIndex(document: ToolpathDocument, nodeId: string): number {
  const directIndex = document.segments.findIndex((segment) => segment.startNodeId === nodeId);
  if (directIndex >= 0) {
    return directIndex;
  }

  const sourceNode = document.nodes[nodeId];
  if (!sourceNode) {
    return document.segments.length;
  }

  let lastIncomingIndex = -1;
  for (let index = document.segments.length - 1; index >= 0; index -= 1) {
    if (document.segments[index].endNodeId === nodeId) {
      lastIncomingIndex = index;
      break;
    }
  }
  const searchStart = lastIncomingIndex >= 0 ? lastIncomingIndex + 1 : 0;

  for (let index = searchStart; index < document.segments.length; index += 1) {
    const segment = document.segments[index];
    const startNode = document.nodes[segment.startNodeId];
    if (startNode && positionsMatch(startNode.position, sourceNode.position)) {
      return index;
    }
  }

  return document.segments.length;
}

function recalculateExtrusion(
  document: ToolpathDocument,
  segment: Segment,
  startNodeId: string
): number {
  if (segment.isTravel) {
    return 0;
  }

  const startNode = document.nodes[startNodeId];
  const endNode = document.nodes[segment.endNodeId];
  if (!startNode || !endNode) {
    return segment.extrusion;
  }

  return distanceBetween(startNode.position, endNode.position) * document.metadata.extrusionPerMm;
}

export function getExtrudeInsertionIndex(document: ToolpathDocument, nodeId: string): number {
  return findInsertionIndex(document, nodeId);
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
  const insertionIndex = getExtrudeInsertionIndex(document, nodeId);
  const nextSegments = [...document.segments];

  if (insertionIndex < nextSegments.length) {
    const followingSegment = nextSegments[insertionIndex];
    nextSegments[insertionIndex] = {
      ...followingSegment,
      startNodeId: nextNodeId,
      extrusion: recalculateExtrusion(
        {
          ...document,
          nodes: {
            ...document.nodes,
            [nextNodeId]: {
              id: nextNodeId,
              position: { ...targetPosition }
            }
          }
        },
        followingSegment,
        nextNodeId
      )
    };
  }

  nextSegments.splice(insertionIndex, 0, {
    id: nextSegmentId,
    startNodeId: nodeId,
    endNodeId: nextNodeId,
    extrusion: extrusionAmount,
    feedrate: inheritedFeedrate,
    isTravel: false,
    command: "G1",
    leadingRawLines: [],
    source: "extruded"
  });

  return {
    ...document,
    nodes: {
      ...document.nodes,
      [nextNodeId]: {
        id: nextNodeId,
        position: { ...targetPosition }
      }
    },
    segments: nextSegments
  };
}
