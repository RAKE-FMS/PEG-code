import { distanceBetween } from "./math";
import type { Segment, ToolpathDocument } from "./types";

function recalculateExtrusion(document: ToolpathDocument, segment: Segment): number {
  if (segment.isTravel) {
    return 0;
  }

  const startNode = document.nodes[segment.startNodeId];
  const endNode = document.nodes[segment.endNodeId];
  if (!startNode || !endNode) {
    return segment.extrusion;
  }

  return distanceBetween(startNode.position, endNode.position) * document.metadata.extrusionPerMm;
}

function deleteNode(document: ToolpathDocument, nodeId: string): ToolpathDocument {
  if (!document.nodes[nodeId]) {
    return document;
  }

  const incomingIndex = document.segments.findIndex((segment) => segment.endNodeId === nodeId);
  const outgoingIndex = document.segments.findIndex((segment) => segment.startNodeId === nodeId);
  const nextNodes = { ...document.nodes };
  delete nextNodes[nodeId];

  if (incomingIndex < 0 && outgoingIndex < 0) {
    return {
      ...document,
      nodes: nextNodes
    };
  }

  const nextSegments = [...document.segments];

  if (incomingIndex >= 0 && outgoingIndex >= 0 && incomingIndex !== outgoingIndex) {
    const incomingSegment = document.segments[incomingIndex];
    const outgoingSegment = document.segments[outgoingIndex];
    const mergedIsTravel = incomingSegment.isTravel && outgoingSegment.isTravel;
    const mergedSegment: Segment = {
      ...incomingSegment,
      endNodeId: outgoingSegment.endNodeId,
      feedrate: outgoingSegment.feedrate,
      isTravel: mergedIsTravel,
      command: mergedIsTravel ? "G0" : "G1",
      inlineComment: outgoingSegment.inlineComment,
      source:
        incomingSegment.source === "extruded" || outgoingSegment.source === "extruded"
          ? "extruded"
          : incomingSegment.source
    };
    const mergedDocument = {
      ...document,
      nodes: nextNodes
    };

    if (mergedSegment.startNodeId === mergedSegment.endNodeId) {
      const sortedIndexes = [incomingIndex, outgoingIndex].sort((left, right) => right - left);
      for (const index of sortedIndexes) {
        nextSegments.splice(index, 1);
      }
    } else {
      mergedSegment.extrusion = recalculateExtrusion(mergedDocument, mergedSegment);
      nextSegments[incomingIndex] = mergedSegment;
      nextSegments.splice(outgoingIndex, 1);
    }

    return {
      ...document,
      nodes: nextNodes,
      segments: nextSegments
    };
  }

  if (incomingIndex >= 0 && outgoingIndex === incomingIndex) {
    nextSegments.splice(incomingIndex, 1);
    return {
      ...document,
      nodes: nextNodes,
      segments: nextSegments
    };
  }

  if (incomingIndex >= 0) {
    nextSegments.splice(incomingIndex, 1);
  }

  if (outgoingIndex >= 0) {
    const adjustedOutgoingIndex = incomingIndex >= 0 && outgoingIndex > incomingIndex
      ? outgoingIndex - 1
      : outgoingIndex;
    nextSegments.splice(adjustedOutgoingIndex, 1);
  }

  return {
    ...document,
    nodes: nextNodes,
    segments: nextSegments
  };
}

export function deleteNodes(document: ToolpathDocument, nodeIds: string[]): ToolpathDocument {
  let nextDocument = document;

  for (const nodeId of nodeIds) {
    nextDocument = deleteNode(nextDocument, nodeId);
  }

  if (
    nextDocument.segments.some(
      (segment) =>
        !nextDocument.nodes[segment.startNodeId] || !nextDocument.nodes[segment.endNodeId]
    )
  ) {
    nextDocument = {
      ...nextDocument,
      segments: nextDocument.segments.filter(
        (segment) => nextDocument.nodes[segment.startNodeId] && nextDocument.nodes[segment.endNodeId]
      )
    };
  }

  return nextDocument;
}
