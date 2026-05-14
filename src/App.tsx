import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "./app/store/editorStore";
import { GcodePanel } from "./components/GcodePanel";
import { Viewport } from "./components/Viewport";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { exportGcode } from "./domain/toolpath/exportGcode";
import { distanceBetween } from "./domain/toolpath/math";
import { serializeGcode } from "./domain/toolpath/serializeGcode";
import type { ToolpathDocument } from "./domain/toolpath/types";
import { openGcodeFile, saveGcodeFile } from "./lib/fileSystem";

const NODE_MATCH_EPSILON = 0.0001;

function describeSelection(vertexCount: number, segmentCount: number): string {
  if (vertexCount === 0 && segmentCount === 0) {
    return "No active selection";
  }

  const labels = [];
  if (vertexCount > 0) labels.push(`${vertexCount} vertex`);
  if (segmentCount > 0) labels.push(`${segmentCount} segment`);
  return `${labels.join(" / ")} selected`;
}

function describeFocusedGcode(
  document: ToolpathDocument,
  serializedLines: ReturnType<typeof serializeGcode>,
  vertexIds: string[],
  segmentIds: string[]
): string {
  const selectedSegmentEndpointNodeIds = new Set<string>();

  for (const segmentId of segmentIds) {
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
        selectedSegmentEndpointNodeIds.add(candidateSegment.endNodeId);
      }
    }
  }

  const matchingLines = serializedLines.filter(
    (line) =>
      (line.nodeId !== undefined && vertexIds.includes(line.nodeId)) ||
      (line.nodeId !== undefined && selectedSegmentEndpointNodeIds.has(line.nodeId)) ||
      line.relatedSegmentIds.some((id) => segmentIds.includes(id))
  );

  if (matchingLines.length === 0) {
    return "No G-code focus";
  }

  const firstLine = matchingLines[0].lineNumber;
  const lastLine = matchingLines[matchingLines.length - 1].lineNumber;
  return firstLine === lastLine ? `Line ${firstLine}` : `Lines ${firstLine}-${lastLine}`;
}

function AppShell(): JSX.Element {
  const {
    document,
    sourceName,
    statusMessage,
    selection,
    hoverTarget,
    activeTool,
    extrudeSession,
    transformSession,
    loadDocument,
    setStatusMessage
  } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      sourceName: state.sourceName,
      statusMessage: state.statusMessage,
      selection: state.selection,
      hoverTarget: state.hoverTarget,
      activeTool: state.activeTool,
      extrudeSession: state.extrudeSession,
      transformSession: state.transformSession,
      loadDocument: state.loadDocument,
      setStatusMessage: state.setStatusMessage
    }))
  );

  const segmentCount = document.segments.length;
  const nodeCount = Object.keys(document.nodes).length;
  const serializedLines = useMemo(() => serializeGcode(document), [document]);
  const workspaceLayoutRef = useRef<HTMLDivElement | null>(null);
  const [gcodePanelWidth, setGcodePanelWidth] = useState(360);
  const selectionLabel = useMemo(
    () => describeSelection(selection.vertexIds.length, selection.segmentIds.length),
    [selection.segmentIds.length, selection.vertexIds.length]
  );
  const focusedGcodeLabel = useMemo(
    () => describeFocusedGcode(document, serializedLines, selection.vertexIds, selection.segmentIds),
    [document, selection.segmentIds, selection.vertexIds, serializedLines]
  );

  useEffect(() => {
    function clampWidth(nextWidth: number): number {
      const containerWidth = workspaceLayoutRef.current?.clientWidth ?? 0;
      if (containerWidth === 0) {
        return Math.min(640, Math.max(280, nextWidth));
      }

      const maxWidth = Math.max(280, Math.min(640, Math.round(containerWidth * 0.55)));
      return Math.min(maxWidth, Math.max(280, nextWidth));
    }

    function handleResize(): void {
      setGcodePanelWidth((currentWidth) => clampWidth(currentWidth));
    }

    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleGcodeResizeStart(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();

    function clampWidth(nextWidth: number): number {
      const containerWidth = workspaceLayoutRef.current?.clientWidth ?? 0;
      if (containerWidth === 0) {
        return Math.min(640, Math.max(280, nextWidth));
      }

      const maxWidth = Math.max(280, Math.min(640, Math.round(containerWidth * 0.55)));
      return Math.min(maxWidth, Math.max(280, nextWidth));
    }

    function handlePointerMove(moveEvent: PointerEvent): void {
      const containerBounds = workspaceLayoutRef.current?.getBoundingClientRect();
      if (!containerBounds) {
        return;
      }

      const nextWidth = containerBounds.right - moveEvent.clientX;
      setGcodePanelWidth(clampWidth(nextWidth));
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  async function handleOpen(): Promise<void> {
    const result = await openGcodeFile();
    if (!result) {
      setStatusMessage("Open cancelled.");
      return;
    }

    loadDocument(result.contents, result.name);
  }

  async function handleExport(): Promise<void> {
    const output = exportGcode(document);
    const defaultFileName = sourceName.replace(/\.(gcode|gc|txt)$/i, "") || "peg-code-export";
    const savedPath = await saveGcodeFile(output, `${defaultFileName}-edited.gcode`);

    if (!savedPath) {
      setStatusMessage("Export cancelled.");
      return;
    }

    setStatusMessage(`Exported ${savedPath}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <h1>PEG-code</h1>
          <p>Path editor for G-code. Toolpath-first modeling for additive motion.</p>
        </div>

        <div className="toolbar-actions">
          <button type="button" onClick={handleOpen}>
            Open G-code
          </button>
          <button type="button" onClick={handleExport} disabled={segmentCount === 0}>
            Export Edited G-code
          </button>
          <button type="button" disabled={selection.vertexIds.length === 0}>
            Move with `G`
          </button>
        </div>
      </header>

      <main className="viewport-shell">
        <ErrorBoundary
          fallbackTitle="Viewport failed to mount"
          fallbackBody="The toolpath viewport crashed during render. The error below should point us to the exact Three.js or React issue."
        >
          <div
            ref={workspaceLayoutRef}
            className="workspace-layout"
            style={{ gridTemplateColumns: `minmax(0, 1fr) ${gcodePanelWidth}px` }}
          >
            <div className="viewport-stage">
              <div className="viewport-overlay">
                <div className="overlay-card">
                  <strong>Document</strong>
                  <span>{sourceName}</span>
                </div>
                <div className="overlay-card">
                  <strong>Tool</strong>
                  <span className={activeTool === "select" ? "accent-text" : "success-text"}>
                    {activeTool === "move"
                      ? "Move active"
                      : activeTool === "extrude"
                        ? "Extrude active"
                        : "Selection mode"}
                  </span>
                </div>
                <div className="overlay-card">
                  <strong>Hover</strong>
                  <span>{hoverTarget ? `${hoverTarget.type}: ${hoverTarget.id}` : "Nothing hovered"}</span>
                </div>
                <div className="overlay-card">
                  <strong>G-code Focus</strong>
                  <span>{focusedGcodeLabel}</span>
                </div>
                {extrudeSession ? (
                  <div className="overlay-card">
                    <strong>Extrude Preview</strong>
                    <span>
                      {extrudeSession.previewPosition.x.toFixed(2)}, {extrudeSession.previewPosition.y.toFixed(2)},
                      {" "}
                      {extrudeSession.previewPosition.z.toFixed(2)}
                    </span>
                  </div>
                ) : null}
                {transformSession ? (
                  <div className="overlay-card">
                    <strong>Transform</strong>
                    <span>
                      {transformSession.mode.toUpperCase()}
                      {" / "}
                      {transformSession.axisLock ? transformSession.axisLock.toUpperCase() : "FREE"}
                      {" / "}
                      {transformSession.numericInput || "pointer"}
                    </span>
                  </div>
                ) : null}
              </div>
              <Viewport />
            </div>
            <GcodePanel width={gcodePanelWidth} onResizeStart={handleGcodeResizeStart} />
          </div>
        </ErrorBoundary>
      </main>

      <footer className="statusbar">
        <div>
          <p>{statusMessage}</p>
          <p>
            {nodeCount} nodes / {segmentCount} segments
          </p>
        </div>
        <div className="legend">
          <span>
            <i className="extrusion" />
            Extrusion
          </span>
          <span>
            <i className="travel" />
            Travel
          </span>
          <span>
            <i className="selection" />
            Selected
          </span>
          <span>{selectionLabel}</span>
          <span>`G` move / `E` extrude / `X Y Z` axis / number input in mm / `Enter` confirm / `Esc` cancel</span>
        </div>
      </footer>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <ErrorBoundary
      fallbackTitle="Application failed to mount"
      fallbackBody="PEG-code hit a startup error before the main UI could render."
    >
      <AppShell />
    </ErrorBoundary>
  );
}
