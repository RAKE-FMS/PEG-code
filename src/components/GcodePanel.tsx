import type { PointerEvent as ReactPointerEvent } from "react";
import { useMemo, useRef } from "react";
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
  const {
    document,
    gcodeDraft,
    isGcodeDirty,
    hoverTarget,
    selection,
    selectVertex,
    setGcodeDraft,
    revertGcodeDraft,
    applyGcodeDraft
  } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      gcodeDraft: state.gcodeDraft,
      isGcodeDirty: state.isGcodeDirty,
      hoverTarget: state.hoverTarget,
      selection: state.selection,
      selectVertex: state.selectVertex,
      setGcodeDraft: state.setGcodeDraft,
      revertGcodeDraft: state.revertGcodeDraft,
      applyGcodeDraft: state.applyGcodeDraft
    }))
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => serializeGcode(document), [document]);
  const draftLines = useMemo(() => gcodeDraft.split("\n"), [gcodeDraft]);
  const selectedSegmentEndpointNodeIds = useMemo(
    () => getSelectedSegmentEndpointNodeIds(document, selection.segmentIds),
    [document, selection.segmentIds]
  );

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

  function focusEditorLine(lineNumber: number): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const linesBeforeTarget = gcodeDraft.split("\n").slice(0, Math.max(0, lineNumber - 1));
    const cursorOffset =
      linesBeforeTarget.length > 0 ? linesBeforeTarget.join("\n").length + 1 : 0;

    textarea.focus();
    textarea.setSelectionRange(cursorOffset, cursorOffset);
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
          <span>Line numbers select the related vertex. Edit the text directly in place.</span>
        </div>
        <div className="gcode-panel-actions">
          <button
            type="button"
            className="gcode-panel-toggle"
            onClick={revertGcodeDraft}
            disabled={!isGcodeDirty}
          >
            Revert
          </button>
          <button
            type="button"
            className="gcode-panel-toggle is-primary"
            onClick={applyGcodeDraft}
            disabled={!isGcodeDirty}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="gcode-editor-shell">
        <div className="gcode-editor-frame">
          <div className="gcode-line-numbers" aria-hidden="true" ref={lineNumbersRef}>
            {draftLines.map((_, index) => {
              const line = lines[index];
              const highlightedByVertex =
                line !== undefined &&
                (matchesSelectedVertex(line.nodeId, selection.vertexIds) ||
                  (selection.segmentIds.length > 0 &&
                    matchesSelectedVertex(line.nodeId, selectedSegmentEndpointNodeIds)));
              const highlightedBySegment =
                line !== undefined && intersects(line.relatedSegmentIds, selection.segmentIds);
              const hoveredByVertex =
                line !== undefined && hoverTarget?.type === "vertex" && line.nodeId === hoverTarget.id;
              const hoveredBySegment =
                line !== undefined && hoverTarget?.type === "segment" && line.segmentId === hoverTarget.id;
              const isFocused = index + 1 === focusLineNumber;

              const className = [
                "gcode-line-number-button",
                highlightedByVertex || highlightedBySegment ? "is-selected" : "",
                hoveredByVertex || hoveredBySegment ? "is-hovered" : "",
                isFocused ? "is-focused" : "",
                line?.kind === "motion" ? "is-motion" : ""
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={index + 1}
                  type="button"
                  className={className}
                  onClick={() => {
                    if (line?.nodeId) {
                      selectVertex(line.nodeId, false);
                    }
                  }}
                  onDoubleClick={() => focusEditorLine(index + 1)}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>

          <textarea
            ref={textareaRef}
            className="gcode-editor"
            aria-label="Editable G-code"
            spellCheck={false}
            value={gcodeDraft}
            onChange={(event) => setGcodeDraft(event.target.value)}
            onScroll={(event) => {
              if (lineNumbersRef.current) {
                lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                applyGcodeDraft();
              }
            }}
          />
        </div>
        <div className="gcode-editor-hint">Apply with Ctrl+Enter or Cmd+Enter. Double-click a line number to jump there.</div>
      </div>
    </aside>
  );
}
