import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "./app/store/editorStore";
import { GcodePanel } from "./components/GcodePanel";
import { Viewport } from "./components/Viewport";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { exportGcode } from "./domain/toolpath/exportGcode";
import { serializeGcode } from "./domain/toolpath/serializeGcode";
import { openGcodeFile, saveGcodeFile } from "./lib/fileSystem";

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
  serializedLines: ReturnType<typeof serializeGcode>,
  vertexIds: string[],
  segmentIds: string[]
): string {
  const matchingLines = serializedLines.filter(
    (line) =>
      line.relatedNodeIds.some((id) => vertexIds.includes(id)) ||
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
    () => describeFocusedGcode(serializedLines, selection.vertexIds, selection.segmentIds),
    [selection.segmentIds, selection.vertexIds, serializedLines]
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
          <button type="button" disabled>
            Move (`G`) soon
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
                  <span className={activeTool === "extrude" ? "success-text" : "accent-text"}>
                    {activeTool === "extrude" ? "Extrude active" : "Selection mode"}
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
          <span>`E` extrude / `Shift` additive selection / `Esc` cancel</span>
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
