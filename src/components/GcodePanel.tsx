import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../app/store/editorStore";
import { distanceBetween } from "../domain/toolpath/math";
import { serializeGcode } from "../domain/toolpath/serializeGcode";
import type { ToolpathDocument } from "../domain/toolpath/types";

const NODE_MATCH_EPSILON = 0.0001;

function intersects(ids: string[], activeIds: string[]): boolean {
  return ids.some((id) => activeIds.includes(id));
}

function matchesSelectedVertex(nodeId: string | undefined, activeVertexIds: string[]): boolean {
  return nodeId !== undefined && activeVertexIds.includes(nodeId);
}

function getSelectedSegmentEndpointNodeIds(
  document: ToolpathDocument,
  selectedSegmentIds: string[]
): string[] {
  const endpointIds = new Set<string>();

  for (const segmentId of selectedSegmentIds) {
    const segment = document.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) {
      continue;
    }

    const startNode = document.nodes[segment.startNodeId];
    const endNode = document.nodes[segment.endNodeId];
    if (!startNode || !endNode) {
      continue;
    }

    for (const candidateSegment of document.segments) {
      const candidateEndNode = document.nodes[candidateSegment.endNodeId];
      if (!candidateEndNode) {
        continue;
      }

      if (
        distanceBetween(candidateEndNode.position, startNode.position) < NODE_MATCH_EPSILON ||
        distanceBetween(candidateEndNode.position, endNode.position) < NODE_MATCH_EPSILON
      ) {
        endpointIds.add(candidateSegment.endNodeId);
      }
    }
  }

  return [...endpointIds];
}

type GcodePanelProps = {
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function GcodePanel({ width, onResizeStart }: GcodePanelProps): JSX.Element {
  const { document, hoverTarget, selection, selectVertex } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      hoverTarget: state.hoverTarget,
      selection: state.selection,
      selectVertex: state.selectVertex
    }))
  );

  const lines = useMemo(() => serializeGcode(document), [document]);
  const selectedSegmentEndpointNodeIds = useMemo(
    () => getSelectedSegmentEndpointNodeIds(document, selection.segmentIds),
    [document, selection.segmentIds]
  );
  const lineRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const focusLineNumber = useMemo(() => {
    if (hoverTarget?.type === "vertex") {
      return lines.find((line) => line.nodeId === hoverTarget.id)?.lineNumber ?? null;
    }

    if (hoverTarget?.type === "segment") {
      return lines.find((line) => line.segmentId === hoverTarget.id)?.lineNumber ?? null;
    }

    if (selection.vertexIds.length > 0) {
      return lines.find((line) => matchesSelectedVertex(line.nodeId, selection.vertexIds))?.lineNumber ?? null;
    }

    if (selection.segmentIds.length > 0) {
      return (
        lines.find(
          (line) =>
            intersects(line.relatedSegmentIds, selection.segmentIds) ||
            matchesSelectedVertex(line.nodeId, selectedSegmentEndpointNodeIds)
        )?.lineNumber ?? null
      );
    }

    return null;
  }, [hoverTarget, lines, selectedSegmentEndpointNodeIds, selection.segmentIds, selection.vertexIds]);

  useEffect(() => {
    if (!focusLineNumber) {
      return;
    }

    const element = lineRefs.current[focusLineNumber];
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLineNumber]);

  function scrollByAmount(direction: "up" | "down"): void {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const nextTop = direction === "up" ? -container.clientHeight * 0.8 : container.clientHeight * 0.8;
    container.scrollBy({ top: nextTop, behavior: "smooth" });
  }

  return (
    <aside className="gcode-panel" style={{ width }}>
      <button
        type="button"
        className="gcode-resize-handle"
        aria-label="Resize G-code panel"
        title="Drag to resize"
        onPointerDown={onResizeStart}
      />
      <div className="gcode-panel-header">
        <div>
          <strong>G-code</strong>
          <span>Double-click a motion line to select its destination vertex.</span>
        </div>
        <div className="gcode-panel-actions">
          <button type="button" onClick={() => scrollByAmount("up")}>
            Up
          </button>
          <button type="button" onClick={() => scrollByAmount("down")}>
            Down
          </button>
          <button
            type="button"
            onClick={() => {
              if (!focusLineNumber) {
                return;
              }

              lineRefs.current[focusLineNumber]?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            Focus
          </button>
        </div>
      </div>

      <div ref={scrollContainerRef} className="gcode-lines" role="list" aria-label="G-code lines" tabIndex={0}>
        <div className="gcode-lines-inner">
          {lines.map((line) => {
            const highlightedByVertex =
              matchesSelectedVertex(line.nodeId, selection.vertexIds) ||
              (selection.segmentIds.length > 0 &&
                matchesSelectedVertex(line.nodeId, selectedSegmentEndpointNodeIds));
            const highlightedBySegment = intersects(line.relatedSegmentIds, selection.segmentIds);
            const hoveredByVertex = hoverTarget?.type === "vertex" && line.nodeId === hoverTarget.id;
            const hoveredBySegment = hoverTarget?.type === "segment" && line.segmentId === hoverTarget.id;
            const isFocused = line.lineNumber === focusLineNumber;

            const className = [
              "gcode-line",
              highlightedByVertex || highlightedBySegment ? "is-selected" : "",
              hoveredByVertex || hoveredBySegment ? "is-hovered" : "",
              isFocused ? "is-focused" : "",
              line.kind === "motion" ? "is-motion" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={line.lineNumber}
                ref={(element) => {
                  lineRefs.current[line.lineNumber] = element;
                }}
                type="button"
                className={className}
                onDoubleClick={() => {
                  if (line.nodeId) {
                    selectVertex(line.nodeId, false);
                  }
                }}
              >
                <span className="gcode-line-number">{line.lineNumber}</span>
                <code>{line.text || " "}</code>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
