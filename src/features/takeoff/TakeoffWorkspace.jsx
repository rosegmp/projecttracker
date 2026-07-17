import { useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize } from "../../utils/fileUi.js";
import { initTakeoffApp } from "./lib/takeoffApp.js";
import {
  listProjectPdfFiles,
  projectFileDisplayName,
  projectFileToBrowserFile,
} from "./projectFilePicker.js";
import { createProjectTakeoffDataService } from "./services/projectTakeoffData.js";
import "./takeoff.css";

const SIDEBAR_LAYOUT_STORAGE_KEY = "project-tracker:takeoff-sidebar-layout:v1";

function initialSidebarLayout() {
  const mobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 820px)")?.matches;
  const fallback = { pagesCollapsed: false, takeoffCollapsed: Boolean(mobile) };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return fallback;
    return {
      pagesCollapsed: Boolean(stored.pagesCollapsed),
      takeoffCollapsed: Boolean(stored.takeoffCollapsed),
    };
  } catch {
    return fallback;
  }
}

function formatProjectFileDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export default function TakeoffWorkspace({ project, projectId, canEdit = true }) {
  const appRef = useRef(null);
  const pickerResolverRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [loadingFileId, setLoadingFileId] = useState("");
  const [sidebarLayout, setSidebarLayout] = useState(initialSidebarLayout);

  const projectPdfs = useMemo(() => listProjectPdfFiles(project), [project]);
  const filteredProjectPdfs = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    if (!query) return projectPdfs;
    return projectPdfs.filter((file) => (
      `${projectFileDisplayName(file)} ${file.folderName || ""}`.toLowerCase().includes(query)
    ));
  }, [pickerSearch, projectPdfs]);

  function closeProjectFilePicker(result = null) {
    const resolve = pickerResolverRef.current;
    pickerResolverRef.current = null;
    setPickerOpen(false);
    setPickerSearch("");
    setPickerError("");
    setLoadingFileId("");
    resolve?.(result);
  }

  async function chooseProjectFile(file) {
    setLoadingFileId(file.id || projectFileDisplayName(file));
    setPickerError("");
    try {
      closeProjectFilePicker(await projectFileToBrowserFile(file));
    } catch (error) {
      setLoadingFileId("");
      setPickerError(error instanceof Error ? error.message : "Unable to open that project file.");
    }
  }

  function toggleSidebar(sidebar) {
    const workspaceWidth = appRef.current?.getBoundingClientRect().width || 0;
    const useSingleSidebar = workspaceWidth > 680 && workspaceWidth < 900;
    setSidebarLayout((current) => {
      if (sidebar === "pages") {
        const pagesCollapsed = !current.pagesCollapsed;
        return {
          ...current,
          pagesCollapsed,
          takeoffCollapsed: useSingleSidebar && !pagesCollapsed ? true : current.takeoffCollapsed,
        };
      }
      const takeoffCollapsed = !current.takeoffCollapsed;
      return {
        ...current,
        takeoffCollapsed,
        pagesCollapsed: useSingleSidebar && !takeoffCollapsed ? true : current.pagesCollapsed,
      };
    });
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(sidebarLayout));
    } catch {
      // Layout preferences are optional when storage is unavailable.
    }
  }, [sidebarLayout]);

  useEffect(() => {
    const workspaceWidth = appRef.current?.getBoundingClientRect().width || 0;
    if (workspaceWidth <= 680 || workspaceWidth >= 900) return;
    if (!sidebarLayout.pagesCollapsed && !sidebarLayout.takeoffCollapsed) {
      setSidebarLayout((current) => ({ ...current, takeoffCollapsed: true }));
    }
  }, [sidebarLayout.pagesCollapsed, sidebarLayout.takeoffCollapsed]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || loadingFileId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeProjectFilePicker();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [loadingFileId, pickerOpen]);

  useEffect(() => {
    if (!appRef.current) return undefined;
    const services = {
      ...createProjectTakeoffDataService({ projectId, canEdit }),
      selectProjectPdf: () => new Promise((resolve) => {
        if (!canEdit) {
          resolve(null);
          return;
        }
        pickerResolverRef.current?.(null);
        pickerResolverRef.current = resolve;
        setPickerError("");
        setPickerOpen(true);
      }),
    };
    const teardown = initTakeoffApp(appRef.current, services);
    return () => {
      pickerResolverRef.current?.(null);
      pickerResolverRef.current = null;
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

        <div className="project-meta">
          <strong id="projectNameDisplay" className="project-name-display">Untitled project</strong>
          <span id="fileName" className="file-name">No drawing loaded</span>
        </div>

        <div className="file-cluster">
          <input id="pdfInput" className="visually-hidden" type="file" accept="application/pdf" />
          <input id="projectInput" className="visually-hidden" type="file" accept=".takeoff.json,application/json" />
          <button id="uploadButton" className="button primary" type="button">Upload PDF</button>
          <button id="selectProjectPdfButton" className="button" type="button" title="Choose a PDF from this project's Files">Project PDF</button>
          <button id="openProjectButton" className="button" type="button" title="Open a saved takeoff">Saved Takeoffs</button>
          <button id="saveProjectButton" className="button" type="button" disabled>Save</button>
          <button id="saveAsProjectButton" className="button" type="button" disabled>Save As</button>
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

      <main className={`workspace${sidebarLayout.pagesCollapsed ? " pages-collapsed" : ""}${sidebarLayout.takeoffCollapsed ? " takeoff-collapsed" : ""}`}>
        <aside className="pages-pane" aria-label="Pages">
          <div className="pane-heading">
            <span className="pages-pane-title">Sheets <span id="sheetCount">0</span></span>
            <button
              className="pane-toggle"
              type="button"
              aria-controls="pagesList"
              aria-expanded={!sidebarLayout.pagesCollapsed}
              aria-label={`${sidebarLayout.pagesCollapsed ? "Expand" : "Collapse"} sheets`}
              title={`${sidebarLayout.pagesCollapsed ? "Expand" : "Collapse"} sheets`}
              onClick={() => toggleSidebar("pages")}
            >{sidebarLayout.pagesCollapsed ? "›" : "‹"}</button>
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
              <div className="empty-state-actions">
                <button id="emptyUploadButton" className="button primary" type="button">Upload PDF</button>
                <button id="emptySelectProjectPdfButton" className="button" type="button">Project PDF</button>
              </div>
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
          <div className="takeoff-sidebar-heading">
            <span className="takeoff-pane-title">Takeoff</span>
            <button
              className="pane-toggle"
              type="button"
              aria-controls="takeoffPaneContent"
              aria-expanded={!sidebarLayout.takeoffCollapsed}
              aria-label={`${sidebarLayout.takeoffCollapsed ? "Expand" : "Collapse"} takeoff controls`}
              title={`${sidebarLayout.takeoffCollapsed ? "Expand" : "Collapse"} takeoff controls`}
              onClick={() => toggleSidebar("takeoff")}
            >{sidebarLayout.takeoffCollapsed ? "‹" : "›"}</button>
          </div>
          <div id="takeoffPaneContent" className="takeoff-pane-content">
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
            <div className="pane-heading tool-options-heading">Count tool</div>
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
            <div className="pane-heading tool-options-heading">Markup tool</div>
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
          </div>
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

      {pickerOpen ? (
        <div className="project-file-picker-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !loadingFileId) closeProjectFilePicker();
        }}>
          <section className="project-file-picker" role="dialog" aria-modal="true" aria-labelledby="projectFilePickerTitle">
            <div className="project-file-picker-header">
              <div>
                <h2 id="projectFilePickerTitle">Choose a project PDF</h2>
                <p className="muted">Select a drawing from this project's Files tab.</p>
              </div>
              <button className="button compact" type="button" disabled={Boolean(loadingFileId)} onClick={() => closeProjectFilePicker()}>Close</button>
            </div>
            <div className="project-file-picker-body">
              <label className="field-label" htmlFor="projectFileSearch">Search project files</label>
              <input
                id="projectFileSearch"
                className="text-input project-file-search"
                type="search"
                value={pickerSearch}
                autoFocus
                onChange={(event) => setPickerSearch(event.target.value)}
                placeholder="File or folder name"
              />
              {pickerError ? <div className="project-file-picker-error" role="alert">{pickerError}</div> : null}
              <div className="project-file-picker-list">
                {filteredProjectPdfs.length ? filteredProjectPdfs.map((file) => {
                  const key = file.id || `${file.folderId}:${projectFileDisplayName(file)}`;
                  const loading = loadingFileId === (file.id || projectFileDisplayName(file));
                  return (
                    <button className="project-file-picker-item" type="button" key={key} disabled={Boolean(loadingFileId)} onClick={() => void chooseProjectFile(file)}>
                      <span className="project-file-picker-name">{projectFileDisplayName(file)}</span>
                      <span className="project-file-picker-meta">
                        {file.folderName || "Project Files"} · {formatFileSize(file.size)} · {formatProjectFileDate(file.uploadedAt)}
                      </span>
                      <span className="project-file-picker-action">{loading ? "Opening…" : "Open"}</span>
                    </button>
                  );
                }) : (
                  <div className="project-file-picker-empty">
                    {projectPdfs.length ? "No PDFs match your search." : "No PDFs are available in this project's Files tab."}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
      </div>
    </div>
  );
}
