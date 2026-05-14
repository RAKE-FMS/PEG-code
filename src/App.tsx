import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "./app/store/editorStore";
import { Viewport } from "./components/Viewport";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { exportGcode } from "./domain/toolpath/exportGcode";
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
  const selectionLabel = useMemo(
    () => describeSelection(selection.vertexIds.length, selection.segmentIds.length),
    [selection.segmentIds.length, selection.vertexIds.length]
  );

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

        <ErrorBoundary
          fallbackTitle="Viewport failed to mount"
          fallbackBody="The toolpath viewport crashed during render. The error below should point us to the exact Three.js or React issue."
        >
          <Viewport />
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
