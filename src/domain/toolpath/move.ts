import { addVector, distanceBetween } from "./math";
import type { ToolpathDocument, Vector3Like } from "./types";

const MIN_DISTANCE = 0.0001;

function collectMovedNodeIds(document: ToolpathDocument, nodeIds: string[]): Set<string> {
  const movedNodeIds = new Set(nodeIds);

  for (const nodeId of nodeIds) {
    const sourceNode = document.nodes[nodeId];
    if (!sourceNode) {
      continue;
    }

    for (const candidateNode of Object.values(document.nodes)) {
      if (distanceBetween(sourceNode.position, candidateNode.position) < MIN_DISTANCE) {
        movedNodeIds.add(candidateNode.id);
      }
    }
  }

  return movedNodeIds;
}

export function moveNodesByOffset(
  document: ToolpathDocument,
  nodeIds: string[],
  offset: Vector3Like
): ToolpathDocument {
  if (
    Math.abs(offset.x) < MIN_DISTANCE &&
    Math.abs(offset.y) < MIN_DISTANCE &&
    Math.abs(offset.z) < MIN_DISTANCE
  ) {
    return document;
  }

  const movedNodeIds = collectMovedNodeIds(document, nodeIds);
  if (movedNodeIds.size === 0) {
    return document;
  }

  const nextNodes = { ...document.nodes };

  for (const nodeId of movedNodeIds) {
    const node = document.nodes[nodeId];
    if (!node) {
      continue;
    }

    nextNodes[nodeId] = {
      ...node,
      position: addVector(node.position, offset)
    };
  }

  const nextSegments = document.segments.map((segment) => {
    if (segment.isTravel) {
      return segment;
    }

    if (!movedNodeIds.has(segment.startNodeId) && !movedNodeIds.has(segment.endNodeId)) {
      return segment;
    }

    const startNode = nextNodes[segment.startNodeId];
    const endNode = nextNodes[segment.endNodeId];
    if (!startNode || !endNode) {
      return segment;
    }

    return {
      ...segment,
      extrusion: distanceBetween(startNode.position, endNode.position) * document.metadata.extrusionPerMm
    };
  });

  return {
    ...document,
    nodes: nextNodes,
    segments: nextSegments
  };
}
