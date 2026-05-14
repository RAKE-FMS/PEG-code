import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

function renderBootstrapError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `
    <div class="error-panel" role="alert">
      <strong>Application failed to bootstrap</strong>
      <p>PEG-code hit an error before React could finish mounting.</p>
      <pre>${message}</pre>
    </div>
  `;
}

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <App />
  );
} catch (error) {
  console.error("PEG-code bootstrap failure", error);
  renderBootstrapError(error);
}
