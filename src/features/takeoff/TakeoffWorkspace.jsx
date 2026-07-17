import { useEffect, useRef } from "react";
import { initTakeoffApp } from "./lib/takeoffApp.js";
import { createProjectTakeoffDataService } from "./services/projectTakeoffData.js";
import "./takeoff.css";

export default function TakeoffWorkspace({ projectId, canEdit = true }) {
  const appRef = useRef(null);

  useEffect(() => {
    if (!appRef.current) return undefined;
    const services = createProjectTakeoffDataService({ projectId, canEdit });
    const teardown = initTakeoffApp(appRef.current, services);
    return () => {
      if (typeof teardown === "function") teardown();
    };
  }, [canEdit, projectId]);

  return (
    <div className="takeoff-feature">
      {!canEdit ? (
        <div className="takeoff-permission-notice" role="status">
          Review mode: you can open and inspect saved takeoffs, but saving changes requires edit access.
        </div>
      ) : null}
      <div ref={appRef} className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"></span>
          <div>
            <strong>Plan Takeoff</strong>
            <small id="scaleBadge">Scale not set</small>
          </div>
        </div>

        <div className="file-cluster">
          <input id="pdfInput" className="visually-hidden" type="file" accept="application/pdf" />
          <input id="projectInput" className="visually-hidden" type="file" accept=".takeoff.json,application/json" />
          <button id="uploadButton" className="button primary" type="button">Upload PDF</button>
          <button id="openProjectButton" className="button" type="button">Open Project</button>
          <button id="saveProjectButton" className="button" type="button" disabled>Save</button>
          <button id="saveAsProjectButton" className="button" type="button" disabled>Save As</button>
          <div className="project-meta">
            <strong id="projectNameDisplay" className="project-name-display">Untitled project</strong>
            <span id="fileName" className="file-name">No drawing loaded</span>
          </div>
        </div>

        <div className="control-cluster project-unit-cluster" aria-label="Project units">
          <label className="inline-field" htmlFor="projectUnitSelect">
            <span>Project Units</span>
            <select id="projectUnitSelect" className="text-input compact-input" defaultValue="ft">
              <option value="ft">ft</option>
              <option value="ft-in">ft + in</option>
              <option value="in">in</option>
              <option value="m">m</option>
              <option value="cm">cm</option>
            </select>
          </label>
        </div>

        <div className="control-cluster" aria-label="Page controls">
          <button id="prevPage" className="icon-button" type="button" title="Previous page" aria-label="Previous page">&lt;</button>
          <span id="pageLabel" className="page-label">Page 0 / 0</span>
          <button id="nextPage" className="icon-button" type="button" title="Next page" aria-label="Next page">&gt;</button>
        </div>

        <div className="control-cluster" aria-label="Zoom controls">
          <button id="zoomOut" className="icon-button" type="button" title="Zoom out" aria-label="Zoom out">-</button>
          <span id="zoomLabel" className="zoom-label">100%</span>
          <button id="zoomIn" className="icon-button" type="button" title="Zoom in" aria-label="Zoom in">+</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="pages-pane" aria-label="Pages">
          <div className="pane-heading">
            <span>Sheets</span>
            <span id="sheetCount">0</span>
          </div>
          <div id="pagesList" className="pages-list"></div>
        </aside>

        <section className="drawing-pane">
          <div className="tool-strip" role="toolbar" aria-label="Takeoff tools">
            <button className="tool-button active" type="button" data-tool="select">Select</button>
            <button className="tool-button" type="button" data-tool="scale">Scale</button>
            <button className="tool-button" type="button" data-tool="length">Length</button>
            <button className="tool-button" type="button" data-tool="area">Area</button>
            <button className="tool-button" type="button" data-tool="count">Count</button>
            <button className="tool-button" type="button" data-tool="pen">Pen</button>
            <button className="tool-button" type="button" data-tool="highlight">Highlight</button>
            <button className="tool-button" type="button" data-tool="text">Text</button>
            <div className="tool-spacer"></div>
            <button id="undoAction" className="button compact" type="button" disabled>Undo</button>
            <button id="redoAction" className="button compact" type="button" disabled>Redo</button>
            <button id="snapToggle" className="button compact toggle-button" type="button" aria-pressed="false">Snap line</button>
            <button id="undoPoint" className="button compact" type="button" disabled>Undo point</button>
            <button id="finishMeasure" className="button compact" type="button" disabled>Finish</button>
          </div>

          <div id="viewer" className="viewer">
            <div id="emptyState" className="empty-state">
              <div className="blueprint-preview" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <h1>Open a drawing set</h1>
              <button id="emptyUploadButton" className="button primary" type="button">Upload PDF</button>
            </div>

            <div id="pageStage" className="page-stage" hidden>
              <canvas id="pdfCanvas"></canvas>
              <svg id="measureOverlay" className="measure-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
            </div>
          </div>

          <div className="statusbar">
            <span id="statusText">Ready</span>
            <span id="draftText"></span>
          </div>
        </section>

        <aside className="takeoff-pane" aria-label="Takeoff">
          <section className="panel-section">
            <div className="pane-heading">
              <span>Scale</span>
              <div className="pane-actions">
                <button id="manualScaleButton" className="text-button" type="button">Manual</button>
                <button id="clearScale" className="text-button" type="button">Clear</button>
              </div>
            </div>
            <p id="scaleStatus" className="muted">Set scale from two known points on the plan.</p>
          </section>

          <section className="panel-section">
            <div className="field-grid count-grid">
              <label>
                <span className="field-label">Symbol</span>
                <div id="countSymbol" className="symbol-picker">
                  <button
                    id="countSymbolButton"
                    className="symbol-picker-button"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                  ></button>
                  <div id="countSymbolMenu" className="symbol-picker-menu" role="listbox" hidden></div>
                </div>
              </label>
              <label>
                <span className="field-label">Color</span>
                <input id="countColor" className="color-input" type="color" defaultValue="#7b4cc2" />
              </label>
            </div>
          </section>

          <section className="panel-section">
            <div className="field-grid markup-grid">
              <label>
                <span className="field-label">Color</span>
                <input id="markupColor" className="color-input" type="color" defaultValue="#e4572e" />
              </label>
            </div>
          </section>

          <section className="panel-section">
            <div className="pane-heading">
              <span>Selection</span>
              <button id="deleteSelected" className="text-button danger" type="button" disabled>Delete</button>
            </div>
            <form id="selectionPanel" className="selection-panel muted">Nothing selected</form>
          </section>

          <section className="panel-section">
            <div className="pane-heading">
              <span>Markups</span>
              <button id="clearMarkups" className="text-button danger" type="button">Clear all</button>
            </div>
            <div id="markupsList" className="markups-list"></div>
          </section>

          <section className="panel-section grow">
            <div className="pane-heading">
              <span>Measurements</span>
              <button id="clearMeasurements" className="text-button danger" type="button">Clear all</button>
            </div>
            <div id="measurementsList" className="measurements-list"></div>
          </section>

          <section className="panel-section">
            <div className="pane-heading">
              <span>Totals</span>
              <button id="exportCsv" className="text-button" type="button">Export CSV</button>
            </div>
            <div id="totalsList" className="totals-list"></div>
          </section>
        </aside>
      </main>

      <dialog id="scaleDialog" className="scale-dialog">
        <form id="scaleForm" method="dialog">
          <h2>Set drawing scale</h2>
          <div className="scale-mode-toggle" role="tablist" aria-label="Scale mode">
            <button id="scaleModeMeasured" className="button compact toggle-button" type="button">From plan</button>
            <button id="scaleModeManual" className="button compact toggle-button" type="button">Manual</button>
          </div>
          <p id="scaleMeasured" className="muted"></p>
          <div id="measuredScaleFields">
            <label className="field-label" htmlFor="scaleLength">Known length</label>
            <div className="scale-fields">
              <input id="scaleLength" className="text-input" type="text" defaultValue="10" required />
              <select id="scaleUnit" className="text-input" defaultValue="ft">
                <option value="ft">ft</option>
                <option value="ft-in">ft + in</option>
                <option value="in">in</option>
                <option value="m">m</option>
                <option value="cm">cm</option>
              </select>
            </div>
          </div>
          <div id="manualScaleFields" hidden>
            <label className="field-label" htmlFor="sheetLength">Drawing length on sheet</label>
            <div className="scale-fields">
              <input id="sheetLength" className="text-input" type="text" defaultValue="1/4" />
              <select id="sheetUnit" className="text-input" defaultValue="in">
                <option value="in">in</option>
                <option value="mm">mm</option>
              </select>
            </div>
            <label className="field-label" htmlFor="manualScaleLength">Represents</label>
            <div className="scale-fields">
              <input id="manualScaleLength" className="text-input" type="text" defaultValue="1" />
              <select id="manualScaleUnit" className="text-input" defaultValue="ft">
                <option value="ft">ft</option>
                <option value="ft-in">ft + in</option>
                <option value="in">in</option>
                <option value="m">m</option>
                <option value="cm">cm</option>
              </select>
            </div>
          </div>
          <label className="scale-checkbox" htmlFor="applyScaleToProject">
            <input id="applyScaleToProject" type="checkbox" />
            <span>Apply this scale to the entire project</span>
          </label>
          <div className="dialog-actions">
            <button id="cancelScale" className="button" value="cancel" type="button">Cancel</button>
            <button className="button primary" value="default" type="submit">Set scale</button>
          </div>
        </form>
      </dialog>

      <dialog id="projectBrowserDialog" className="project-browser-dialog">
        <div className="project-browser-shell">
          <div className="project-browser-header">
            <div>
              <h2>Saved takeoffs</h2>
              <p className="muted">Reopen a saved plan or import a legacy takeoff file.</p>
            </div>
            <div className="project-browser-actions">
              <button id="refreshProjectsButton" className="button compact" type="button">Refresh</button>
              <button id="importProjectButton" className="button compact" type="button">Import file</button>
              <button id="closeProjectBrowser" className="button compact" type="button">Close</button>
            </div>
          </div>
          <div id="projectBrowserStatus" className="project-browser-status muted">Checking saved takeoffs...</div>
          <div id="projectBrowserList" className="project-browser-list"></div>
        </div>
      </dialog>

      <dialog id="saveNameDialog" className="save-name-dialog">
        <form id="saveNameForm" method="dialog">
          <h2>Save Project As</h2>
          <p className="muted">Choose the project name for this saved copy.</p>
          <label className="field-label" htmlFor="saveNameInput">Project name</label>
          <input id="saveNameInput" className="text-input" type="text" maxLength="120" />
          <div className="dialog-actions">
            <button id="saveNameCancel" className="button" type="button">Cancel</button>
            <button id="saveNameConfirm" className="button primary" type="submit">Save As</button>
          </div>
        </form>
      </dialog>
      </div>
    </div>
  );
}
