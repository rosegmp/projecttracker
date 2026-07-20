import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const COLORS = {
  length: "#e4572e",
  area: "#177e89",
  count: "#7b4cc2",
  scale: "#f2b84b",
};

const COUNT_SYMBOL_OPTIONS = [
  { value: "duplex-receptacle", label: "Duplex Receptacle", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-duplex.svg" },
  { value: "weatherproof-duplex", label: "Weatherproof Duplex Receptacle", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-duplex-wp.svg" },
  { value: "gfci-duplex", label: "GFCI Duplex Receptacle", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-duplex-gfci.svg" },
  { value: "switched-duplex", label: "Duplex Receptacle - One Receptacle Controlled by Switch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-duplex-switched.svg" },
  { value: "emergency-duplex", label: "Duplex Receptacle on Emergency Branch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-duplex-emerg.svg" },
  { value: "quad-receptacle", label: "Double Duplex Receptacle (aka Quad Receptacle)", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-quad.svg" },
  { value: "switch", label: "Switch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-switch.svg" },
  { value: "three-way-switch", label: "3-Way Switch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-switch-3way.svg" },
  { value: "dimmer-switch", label: "Switch with Built-In Dimmer", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-switch-dimmer.svg" },
  { value: "power-panel", label: "Power Panel", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-panel-power.svg" },
  { value: "lighting-panel", label: "Lighting Panel", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-panel-lighting.svg" },
  { value: "junction-box", label: "Junction Box", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-box-junction.svg" },
  { value: "recessed-floor-box", label: "Recessed Floor Box", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-box-floor.svg" },
  { value: "through-wall-sleeve", label: "Through-Wall Sleeve", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/power-sleeve.svg" },
  { value: "light-2x2", label: "2x2 Recessed Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-2x2-1.svg" },
  { value: "light-2x2-emergency", label: "2x2 Recessed Light on Emergency Branch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-2x2-emerg.svg" },
  { value: "light-2x4", label: "2x4 Recessed Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-2x4-1.svg" },
  { value: "light-2x4-emergency", label: "2x4 Recessed Light on Emergency Branch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-2x4-emerg.svg" },
  { value: "linear-light", label: "Recessed Linear Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-linear.svg" },
  { value: "linear-light-emergency", label: "Recessed Linear Light on Emergency Branch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-linear-emerg.svg" },
  { value: "utility-light", label: "Surface Mounted Utility Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-utility.svg" },
  { value: "track-lighting", label: "Track Lighting", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-track.svg" },
  { value: "can-light", label: "Recessed Can Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-can.svg" },
  { value: "wall-light", label: "Wall Mounted Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-wall.svg" },
  { value: "wall-wash-light", label: "Recessed Wall Wash Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/light-wall-wash.svg" },
  { value: "fire-pull-box", label: "Fire Alarm Pull Box", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-pull-box.svg" },
  { value: "horn-strobe", label: "Fire Alarm Strobe and Horn Combination", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-strobe.svg" },
  { value: "smoke-detector", label: "Smoke Detector", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-smoke-detector.svg" },
  { value: "key-box", label: "Fire Department Key Box", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-keybox.svg" },
  { value: "exit-sign-ceiling", label: "Ceiling Mounted Exit Sign", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-exit.svg" },
  { value: "exit-sign-wall", label: "Wall Mounted Exit Sign", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-exit-wall.svg" },
  { value: "emergency-light", label: "Battery Powered Emergency Light", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/fa-light-emerg.svg" },
  { value: "panic-button", label: "Panic Button or Distress Button", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-button-panic.svg" },
  { value: "card-reader", label: "Card Reader", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-card-reader.svg" },
  { value: "magnetic-door-lock", label: "Magnetic Door Lock", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-lock-mag.svg" },
  { value: "electric-door-latch", label: "Electric Door Latch", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-latch-elect.svg" },
  { value: "electric-door-strike", label: "Electric Door Strike", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-strike-elect.svg" },
  { value: "data-jack", label: "Data Jack", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/comms-data.svg" },
  { value: "telephone-jack", label: "Telephone Jack", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/comms-phone.svg" },
  { value: "data-jack-wall", label: "Data Jack for Wall Mounted Item", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/comms-data-wall.svg" },
  { value: "combo-telephone-data", label: "Combination Telephone and Data Jack", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/comms-tele-data.svg" },
  { value: "ceiling-speaker", label: "Ceiling Mounted Speaker", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/comms-speaker.svg" },
  { value: "security-camera", label: "Security Camera", imageUrl: "https://www.archtoolbox.com/wp-content/uploads/security-camera.svg" },
];

const SNAP_RADIUS_PX = 14;
const SNAP_DARKNESS_THRESHOLD = 185;
const DEFAULT_SESSION_STORAGE_KEY = "plan-takeoff:autosave";
const SESSION_DB_NAME = "plan-takeoff-db";
const SESSION_DB_VERSION = 1;
const SESSION_STORE_NAME = "sessions";

function createInitialState() {
  return {
  pdfDoc: null,
  pdfName: "",
  projectName: "",
  projectUnit: "ft",
  pdfDataBase64: "",
  savedProjectId: "",
  pageNumber: 1,
  zoom: 1,
  tool: "select",
  snapToLine: false,
  draft: [],
  previewPoint: null,
  measurements: [],
  markups: [],
  activeMarkup: null,
  selectedId: null,
  selectedType: null,
  selectedPointIndex: null,
  scales: {},
  countSymbol: COUNT_SYMBOL_OPTIONS[0].value,
  countColor: COLORS.count,
  markupColor: "#e4572e",
  renderToken: 0,
  renderTask: null,
  countSymbolMenuOpen: false,
  scaleMode: "measured",
  pageMetrics: {},
  sessionSaveTimer: null,
  dirty: false,
  lastSavedFingerprint: "",
  pan: null,
  moveDrag: null,
  suppressOverlayClickOnce: false,
  undoStack: [],
  redoStack: [],
  restoringHistory: false,
  };
}

let state = createInitialState();
let els = {};
let appRoot = null;
let dataService = null;
let sessionStorageKey = DEFAULT_SESSION_STORAGE_KEY;
let readOnly = false;
let saveNameDialogMode = "save-as";
let renameTargetProjectId = "";

export function initTakeoffApp(root, services = {}) {
  state = createInitialState();
  els = {};
  appRoot = root;
  dataService = services;
  sessionStorageKey = String(services.sessionKey || DEFAULT_SESSION_STORAGE_KEY);
  readOnly = Boolean(services.readOnly);
  bindElements(root);
  applyReadOnlyMode(root);
  const unbindEvents = bindEvents();
  configurePdfJs();
  syncScaleLengthInput();
  restoreSessionState().finally(renderAll);
  return () => {
    persistSessionState();
    if (state.sessionSaveTimer) window.clearTimeout(state.sessionSaveTimer);
    unbindEvents();
    appRoot = null;
    dataService = null;
  };
}

function applyReadOnlyMode(root) {
  root.classList.toggle("is-read-only", readOnly);
  if (!readOnly) return;
  [
    "uploadButton",
    "emptyUploadButton",
    "selectProjectPdfButton",
    "emptySelectProjectPdfButton",
    "saveProjectButton",
    "saveAsProjectButton",
    "importProjectButton",
    "undoAction",
    "redoAction",
    "snapToggle",
    "undoPoint",
    "finishMeasure",
    "clearScale",
    "manualScaleButton",
    "deleteSelected",
    "clearMarkups",
    "clearMeasurements",
  ].forEach((id) => {
    if (els[id]) els[id].disabled = true;
  });
  els.toolButtons.forEach((button) => {
    if (button.dataset.tool !== "select") button.disabled = true;
  });
}

function bindElements(root) {
  [
    "pdfInput",
    "projectInput",
    "uploadButton",
    "selectProjectPdfButton",
    "openProjectButton",
    "saveProjectButton",
    "saveAsProjectButton",
    "projectNameDisplay",
    "projectUnitSelect",
    "projectBrowserDialog",
    "projectBrowserList",
    "projectBrowserStatus",
    "refreshProjectsButton",
    "importProjectButton",
    "closeProjectBrowser",
    "emptyUploadButton",
    "emptySelectProjectPdfButton",
    "fileName",
    "scaleBadge",
    "prevPage",
    "nextPage",
    "pageLabel",
    "zoomOut",
    "zoomIn",
    "zoomLabel",
    "undoAction",
    "redoAction",
    "sheetCount",
    "pagesList",
    "viewer",
    "emptyState",
    "pageStage",
    "pdfCanvas",
    "measureOverlay",
    "statusText",
    "draftText",
    "snapToggle",
    "undoPoint",
    "finishMeasure",
    "clearScale",
    "manualScaleButton",
    "scaleStatus",
    "countSymbol",
    "countSymbolButton",
    "countSymbolMenu",
    "countColor",
    "markupColor",
    "deleteSelected",
    "selectionPanel",
    "markupsList",
    "clearMarkups",
    "measurementsList",
    "clearMeasurements",
    "totalsList",
    "exportCsv",
    "scaleDialog",
    "scaleForm",
    "scaleMeasured",
    "scaleModeMeasured",
    "scaleModeManual",
    "measuredScaleFields",
    "scaleLength",
    "scaleUnit",
    "manualScaleFields",
    "sheetLength",
    "sheetUnit",
    "manualScaleLength",
    "manualScaleUnit",
    "applyScaleToProject",
    "cancelScale",
    "saveNameDialog",
    "saveNameForm",
    "saveNameInput",
    "saveNameCancel",
    "saveNameConfirm",
  ].forEach((id) => {
    els[id] = root.querySelector(`#${id}`);
  });
  els.toolButtons = [...root.querySelectorAll("[data-tool]")];
}

function bindEvents() {
  const eventController = new AbortController();
  const { signal } = eventController;
  const on = (target, type, listener, options = {}) => {
    target.addEventListener(type, listener, { ...options, signal });
  };

  on(els.uploadButton, "click", () => els.pdfInput.click());
  on(els.emptyUploadButton, "click", () => els.pdfInput.click());
  on(els.selectProjectPdfButton, "click", selectProjectPdf);
  on(els.emptySelectProjectPdfButton, "click", selectProjectPdf);
  on(els.openProjectButton, "click", openProjectBrowser);
  on(els.saveProjectButton, "click", () => {
    saveTakeoffProject({ promptForName: false, duplicateProject: false });
  });
  on(els.saveAsProjectButton, "click", openSaveAsDialog);
  on(els.importProjectButton, "click", () => els.projectInput.click());
  on(els.refreshProjectsButton, "click", refreshProjectBrowser);
  on(els.closeProjectBrowser, "click", closeProjectBrowser);
  on(els.pdfInput, "change", (event) => {
    const [file] = event.target.files;
    if (file) requestPdfLoad(file);
    event.target.value = "";
  });
  on(els.projectInput, "change", (event) => {
    const [file] = event.target.files;
    if (file) loadTakeoffProject(file);
    event.target.value = "";
  });

  on(els.prevPage, "click", () => setPage(state.pageNumber - 1));
  on(els.nextPage, "click", () => setPage(state.pageNumber + 1));
  on(els.zoomOut, "click", () => setZoom(state.zoom - 0.1));
  on(els.zoomIn, "click", () => setZoom(state.zoom + 0.1));
  on(els.undoAction, "click", undoAction);
  on(els.redoAction, "click", redoAction);
  on(els.viewer, "wheel", handleViewerWheel, { passive: false });
  on(els.viewer, "pointerdown", handleViewerPointerDown);
  on(els.viewer, "contextmenu", handleViewerContextMenu);
  on(els.pagesList, "click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(".page-thumb");
    if (!button) return;
    setPage(Number(button.dataset.page));
  });

  els.toolButtons.forEach((button) => {
    on(button, "click", () => setTool(button.dataset.tool));
  });
  on(els.snapToggle, "click", toggleSnapToLine);

  on(els.measureOverlay, "pointerdown", handleOverlayPointerDown);
  on(els.measureOverlay, "click", handleOverlayClick);
  on(els.measureOverlay, "dblclick", handleOverlayDoubleClick);
  on(els.measureOverlay, "pointermove", handleOverlayPointerMove);
  on(els.measureOverlay, "pointerup", finishActiveMarkup);
  on(els.measureOverlay, "pointercancel", cancelActiveMarkup);
  on(els.measureOverlay, "pointerleave", clearPreviewPoint);
  on(els.measureOverlay, "contextmenu", handleOverlayContextMenu);

  on(els.undoPoint, "click", undoDraftPoint);
  on(els.finishMeasure, "click", finishDraft);

  on(els.clearScale, "click", () => {
    const before = createHistorySnapshot();
    delete state.scales[state.pageNumber];
    state.draft = [];
    state.previewPoint = null;
    pushUndoSnapshot(before);
    renderAll();
    setStatus(`Scale cleared for sheet ${state.pageNumber}.`);
  });
  on(els.manualScaleButton, "click", () => openScaleDialogForMode("manual"));

  on(els.countSymbolButton, "click", () => toggleCountSymbolMenu());
  on(els.countColor, "input", (event) => {
    state.countColor = event.target.value;
    const measurement = selectedMeasurement();
    if (measurement?.type === "count") {
      measurement.color = state.countColor;
      renderAll();
    }
  });
  on(els.markupColor, "input", (event) => {
    state.markupColor = event.target.value;
  });

  on(els.deleteSelected, "click", deleteSelected);
  on(els.clearMeasurements, "click", clearMeasurements);
  on(els.clearMarkups, "click", clearMarkups);
  on(els.exportCsv, "click", exportCsv);
  on(els.selectionPanel, "submit", handleSelectionSubmit);
  on(els.cancelScale, "click", closeScaleDialog);
  on(els.scaleForm, "submit", applyScale);
  on(els.saveNameForm, "submit", submitSaveAsDialog);
  on(els.saveNameCancel, "click", closeSaveAsDialog);
  on(els.scaleUnit, "change", (event) => {
    setProjectMeasurementUnit(event.target.value);
  });
  on(els.manualScaleUnit, "change", (event) => {
    setProjectMeasurementUnit(event.target.value);
  });
  on(els.projectUnitSelect, "change", (event) => {
    setProjectMeasurementUnit(event.target.value);
    renderAll();
    setStatus("Project measurement units updated.");
  });
  on(els.scaleModeMeasured, "click", () => setScaleMode("measured"));
  on(els.scaleModeManual, "click", () => setScaleMode("manual"));

  on(els.viewer, "dragover", (event) => {
    event.preventDefault();
    els.viewer.classList.add("drag-over");
  });
  on(els.viewer, "dragleave", () => els.viewer.classList.remove("drag-over"));
  on(els.viewer, "drop", (event) => {
    event.preventDefault();
    els.viewer.classList.remove("drag-over");
    const file = [...event.dataTransfer.files].find((item) => item.type === "application/pdf");
    if (file) requestPdfLoad(file);
  });

  on(document, "keydown", handleDocumentKeydown);
  on(document, "click", handleDocumentClick);
  on(window, "beforeunload", handleBeforeUnload);

  return () => eventController.abort();
}

function confirmReplaceCurrentDrawing() {
  if (!state.dirty) return true;
  return window.confirm("Replace this drawing? Unsaved Takeoff changes will be discarded.");
}

async function requestPdfLoad(file) {
  if (!file || !confirmReplaceCurrentDrawing()) return;
  await loadPdf(file);
}

async function selectProjectPdf() {
  if (readOnly || typeof dataService?.selectProjectPdf !== "function") return;
  if (!confirmReplaceCurrentDrawing()) return;
  const file = await dataService.selectProjectPdf();
  if (file) await loadPdf(file);
}

function handleDocumentKeydown(event) {
  if (!appRoot) return;
  if (readOnly && event.key !== "Escape") return;
    if (event.key === "Escape" && state.countSymbolMenuOpen) {
      closeCountSymbolMenu();
      return;
    }
    if (event.key === "Escape" && els.projectBrowserDialog?.open) {
      closeProjectBrowser();
      return;
    }
    if (event.key === "Escape") {
      const hadDraft = Boolean(state.draft.length || state.previewPoint || state.activeMarkup);
      const hadSelection = Boolean(state.selectedId);
      state.draft = [];
      state.previewPoint = null;
      state.activeMarkup = null;
      state.selectedId = null;
      state.selectedType = null;
      state.selectedPointIndex = null;
      renderAll();
      if (hadDraft && hadSelection) {
        setStatus("Draft and selection cleared.");
      } else if (hadDraft) {
        setStatus("Draft cleared.");
      } else if (hadSelection) {
        setStatus("Selection cleared.");
      }
    }
    if (event.key === "Enter" && state.draft.length) {
      finishDraft();
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoAction();
    }
    if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y")
      || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z")) {
      event.preventDefault();
      redoAction();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag !== "input" && activeTag !== "select") deleteSelected();
    }
}

function handleDocumentClick(event) {
  if (!appRoot) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!state.countSymbolMenuOpen || target?.closest("#countSymbol")) return;
  closeCountSymbolMenu();
}

function configurePdfJs() {
  const pdfjs = getPdfJs();
  if (!pdfjs) {
    setStatus("PDF.js could not be loaded. Check the network connection and reload.");
    return;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

async function loadPdf(file) {
  const pdfjs = getPdfJs();
  if (!pdfjs) {
    setStatus("PDF rendering library is unavailable.");
    return;
  }

  try {
    setStatus("Loading PDF...");
    const arrayBuffer = await file.arrayBuffer();
    const pdfDataBase64 = arrayBufferToBase64(arrayBuffer);
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    state.pdfDoc = pdfDoc;
    state.pdfName = file.name;
    state.projectName = fileStem(file.name) || "Untitled takeoff";
    state.projectUnit = "ft";
    state.pdfDataBase64 = pdfDataBase64;
    state.savedProjectId = "";
    state.pageNumber = 1;
    state.zoom = 1;
    state.draft = [];
    state.previewPoint = null;
    state.measurements = [];
    state.markups = [];
    state.activeMarkup = null;
    state.selectedId = null;
    state.selectedType = null;
    state.scales = {};
    state.undoStack = [];
    state.redoStack = [];
    state.pageMetrics = {};
    els.scaleUnit.value = state.projectUnit;
    els.manualScaleUnit.value = state.projectUnit;
    els.projectUnitSelect.value = state.projectUnit;

    await buildPageList();
    await renderPage();
    setTool("select");
    markSessionSaved();
    renderAll();
    setStatus(`Loaded ${file.name}.`);
  } catch (error) {
    console.error(error);
    setStatus("Unable to open that PDF.");
  }
}

async function loadTakeoffProject(file) {
  try {
    setStatus("Opening takeoff file...");
    const project = JSON.parse(await file.text());
    await hydrateProject(project, {
      fallbackPdfName: file.name.replace(/\.takeoff\.json$/i, ".pdf"),
      statusMessage: `Opened ${file.name}.`,
      markSaved: true,
    });
    closeProjectBrowser();
    setStatus(`Opened ${file.name}.`);
  } catch (error) {
    console.error(error);
    setStatus("Unable to open that takeoff file.");
  }
}

async function saveTakeoffProject() {
  return saveTakeoffProjectWithOptions({ promptForName: true, duplicateProject: false });
}

async function saveTakeoffProjectWithOptions(options = {}) {
  if (!state.pdfDoc || !state.pdfDataBase64) {
    setStatus("Load a PDF before saving.");
    return;
  }

  try {
    const promptForName = options.promptForName !== false;
    const duplicateProject = Boolean(options.duplicateProject);
    if (promptForName) {
      const trimmedName = String(options.projectName || "").trim();
      if (!trimmedName) {
        setStatus("Enter a project name before saving.");
        return;
      }
      state.projectName = trimmedName;
    }

    const project = createProjectSnapshot();
    if (duplicateProject) {
      delete project.id;
    }
    if (!dataService?.saveProject) {
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" });
      downloadBlob(blob, `${fileStem(state.pdfName) || "takeoff"}.takeoff.json`);
      markSessionSaved();
      setStatus("Takeoff file saved.");
      return;
    }

    setStatus("Saving takeoff...");
    const existingId = duplicateProject ? "" : state.savedProjectId;
    const result = await dataService.saveProject(project, existingId);
    state.savedProjectId = result?.id || state.savedProjectId;
    markSessionSaved();
    refreshProjectBrowser().catch(() => {});
    if (result?.storageMode === "supabase") {
      setStatus("Takeoff saved to Supabase.");
      return;
    }
    if (result?.storageMode === "local") {
      setStatus(result.storageIssue
        ? `Saved locally. Supabase save failed: ${result.storageIssue}`
        : "Takeoff saved locally. Remote save is unavailable.");
      return;
    }
    setStatus("Takeoff saved in browser storage.");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Unable to save takeoff.");
  }
}

function openSaveAsDialog() {
  if (!state.pdfDoc || !state.pdfDataBase64) {
    setStatus("Load a PDF before saving.");
    return;
  }
  const currentName = String(state.projectName || fileStem(state.pdfName) || "Untitled takeoff").trim();
  saveNameDialogMode = "save-as";
  renameTargetProjectId = "";
  els.saveNameDialog.querySelector("h2").textContent = "Save Project As";
  els.saveNameDialog.querySelector(".muted").textContent = "Choose the project name for this saved copy.";
  els.saveNameConfirm.textContent = "Save As";
  els.saveNameInput.value = currentName;
  if (typeof els.saveNameDialog.showModal === "function") {
    els.saveNameDialog.showModal();
    window.setTimeout(() => {
      els.saveNameInput.focus();
      els.saveNameInput.select();
    }, 0);
  } else {
    setStatus("Save As requires dialog support in this browser.");
  }
}

function closeSaveAsDialog() {
  if (els.saveNameDialog?.open) {
    els.saveNameDialog.close();
  }
}

async function submitSaveAsDialog(event) {
  event.preventDefault();
  const projectName = String(els.saveNameInput.value || "").trim();
  if (!projectName) {
    setStatus("Enter a project name before saving.");
    els.saveNameInput.focus();
    return;
  }
  closeSaveAsDialog();
  if (saveNameDialogMode === "rename") {
    await submitRenameProject(renameTargetProjectId, projectName);
    return;
  }
  await saveTakeoffProjectWithOptions({
    promptForName: true,
    duplicateProject: true,
    projectName,
  });
}

function openProjectBrowser() {
  if (!els.projectBrowserDialog) return;
  els.projectBrowserDialog.showModal();
  refreshProjectBrowser().catch((error) => {
    console.error(error);
    if (els.projectBrowserStatus) {
      els.projectBrowserStatus.textContent = "Unable to load saved takeoffs.";
    }
  });
}

function closeProjectBrowser() {
  if (els.projectBrowserDialog?.open) {
    els.projectBrowserDialog.close();
  }
}

async function refreshProjectBrowser() {
  if (!els.projectBrowserList || !els.projectBrowserStatus) return;
  els.projectBrowserStatus.textContent = "Loading saved takeoffs...";
  els.projectBrowserList.innerHTML = "";

  if (!dataService?.listProjects) {
    els.projectBrowserStatus.textContent = "Saved takeoff browser is unavailable.";
    return;
  }

  const result = await dataService.listProjects();
  renderProjectBrowser(result.projects || []);
  if (result.storageMode === "supabase") {
    els.projectBrowserStatus.textContent = "Showing saved takeoffs from Supabase and browser storage.";
    return;
  }
  if (result.storageMode === "local") {
    els.projectBrowserStatus.textContent = "Showing browser-saved takeoffs. Supabase is unavailable right now.";
    return;
  }
  els.projectBrowserStatus.textContent = "Showing browser-saved takeoffs on this device.";
}

function renderProjectBrowser(projects) {
  els.projectBrowserList.innerHTML = "";
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "project-browser-empty";
    empty.textContent = "No saved takeoffs yet.";
    els.projectBrowserList.append(empty);
    return;
  }

  projects.forEach((project) => {
    const row = document.createElement("div");
    row.className = "project-browser-item";
    if (project.id === state.savedProjectId) row.classList.add("active");

    const meta = document.createElement("div");
    meta.className = "project-browser-item-meta";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "project-browser-open";
    title.textContent = project.name || fileStem(project.pdfName || "Untitled takeoff");
    title.addEventListener("click", () => openSavedProject(project.id));

    const details = document.createElement("div");
    details.className = "project-browser-item-details";
    details.innerHTML =
      `<span>${escapeHtml(project.pdfName || "Drawing.pdf")}</span>` +
      `<span>${escapeHtml(formatSavedTimestamp(project.updatedAt))}</span>`;

    const badges = document.createElement("div");
    badges.className = "project-browser-badges";
    const sourceBadge = createProjectBadge(project.source === "supabase" ? "Supabase" : "Browser");
    const offlineBadge = project.hasLocalData ? createProjectBadge("Offline copy") : null;
    if (sourceBadge) badges.append(sourceBadge);
    if (offlineBadge) badges.append(offlineBadge);

    meta.append(title, details, badges);

    const actions = document.createElement("div");
    actions.className = "project-browser-item-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "button compact";
    openButton.textContent = "Open";
    openButton.addEventListener("click", () => openSavedProject(project.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "button compact";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteSavedProject(project.id, project.name));

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "button compact";
    renameButton.textContent = "Rename";
    renameButton.addEventListener("click", () => openRenameProjectDialog(project.id, project.name));

    actions.append(openButton, renameButton, deleteButton);
    row.append(meta, actions);
    els.projectBrowserList.append(row);
  });
}

function openRenameProjectDialog(projectId, projectName) {
  saveNameDialogMode = "rename";
  renameTargetProjectId = projectId;
  els.saveNameDialog.querySelector("h2").textContent = "Rename Project";
  els.saveNameDialog.querySelector(".muted").textContent = "Choose a new name for this saved project.";
  els.saveNameConfirm.textContent = "Rename";
  els.saveNameInput.value = String(projectName || "").trim();
  if (typeof els.saveNameDialog.showModal === "function") {
    els.saveNameDialog.showModal();
    window.setTimeout(() => {
      els.saveNameInput.focus();
      els.saveNameInput.select();
    }, 0);
  }
}

async function submitRenameProject(projectId, projectName) {
  if (!projectId || !dataService?.renameProject) {
    setStatus("Unable to rename that project.");
    return;
  }
  const result = await dataService.renameProject(projectId, projectName);
  if (state.savedProjectId === projectId) {
    state.projectName = projectName;
    renderAll();
  }
  await refreshProjectBrowser();
  if (result?.storageMode === "supabase") {
    setStatus("Saved project renamed.");
    return;
  }
  if (result?.storageMode === "local") {
    setStatus(result.storageIssue
      ? `Project renamed locally. Remote rename failed: ${result.storageIssue}`
      : "Project renamed locally.");
    return;
  }
  setStatus("Project renamed in browser storage.");
}

function createProjectBadge(label) {
  if (!label) return null;
  const badge = document.createElement("span");
  badge.className = "project-browser-badge";
  badge.textContent = label;
  return badge;
}

function formatSavedTimestamp(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Saved recently";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function openSavedProject(projectId) {
  if (!dataService?.loadProject) return;
  try {
    els.projectBrowserStatus.textContent = "Opening saved takeoff...";
    const result = await dataService.loadProject(projectId);
    await hydrateProject(result.project, {
      fallbackPdfName: result.project?.pdfName || "Saved drawing.pdf",
      statusMessage: `Opened ${result.project?.pdfName || "saved takeoff"}.`,
      markSaved: true,
    });
    closeProjectBrowser();
    setStatus(`Opened ${result.project?.pdfName || "saved takeoff"}.`);
  } catch (error) {
    console.error(error);
    els.projectBrowserStatus.textContent = "Unable to open that saved takeoff.";
  }
}

async function deleteSavedProject(projectId, projectName) {
  const confirmed = window.confirm(`Delete ${projectName || "this saved takeoff"}?`);
  if (!confirmed || !dataService?.deleteProject) return;

  const deletingCurrentProject = state.savedProjectId === projectId;
  const result = await dataService.deleteProject(projectId);
  if (deletingCurrentProject) {
    state.savedProjectId = "";
    state.projectName = fileStem(state.pdfName) || "Untitled project";
    state.dirty = true;
    renderAll();
  }
  await refreshProjectBrowser();
  if (result?.storageMode === "supabase") {
    setStatus(result.storageIssue
      ? `Project deleted. File cleanup warning: ${result.storageIssue}`
      : "Saved project deleted.");
    return;
  }
  if (result?.storageMode === "local") {
    setStatus(result.storageIssue
      ? `Local copy deleted. Remote delete failed: ${result.storageIssue}`
      : "Local copy deleted. Remote delete is unavailable.");
    return;
  }
  setStatus("Saved project deleted from browser storage.");
}

async function buildPageList() {
  els.pagesList.innerHTML = "";
  if (!state.pdfDoc) return;

  for (let pageNumber = 1; pageNumber <= state.pdfDoc.numPages; pageNumber += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-thumb";
    button.dataset.page = String(pageNumber);

    const canvas = document.createElement("canvas");
    const copy = document.createElement("div");
    copy.innerHTML = `<strong>Sheet ${pageNumber}</strong><span>Page ${pageNumber}</span>`;

    button.append(canvas, copy);
    els.pagesList.append(button);
    renderThumbnail(pageNumber, canvas);
  }
}

async function renderThumbnail(pageNumber, canvas) {
  try {
    const page = await state.pdfDoc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(0.22, 56 / base.width, 74 / base.height);
    const viewport = page.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    const context = canvas.getContext("2d");

    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    await page.render({ canvasContext: context, viewport }).promise;
  } catch (error) {
    console.warn("Thumbnail render failed", error);
  }
}

async function renderPage() {
  if (!state.pdfDoc) {
    els.pageStage.hidden = true;
    els.emptyState.hidden = false;
    return;
  }

  const token = (state.renderToken += 1);
  const pageNumber = state.pageNumber;
  cancelActiveRender();

  const page = await state.pdfDoc.getPage(pageNumber);
  if (token !== state.renderToken) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: state.zoom });
  state.pageMetrics[pageNumber] = capturePageMetrics(page, baseViewport);
  const ratio = window.devicePixelRatio || 1;
  const context = els.pdfCanvas.getContext("2d");

  els.pageStage.hidden = false;
  els.emptyState.hidden = true;
  els.pageStage.style.width = `${viewport.width}px`;
  els.pageStage.style.height = `${viewport.height}px`;

  els.pdfCanvas.width = Math.floor(viewport.width * ratio);
  els.pdfCanvas.height = Math.floor(viewport.height * ratio);
  els.pdfCanvas.style.width = `${viewport.width}px`;
  els.pdfCanvas.style.height = `${viewport.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  const renderTask = page.render({ canvasContext: context, viewport });
  state.renderTask = renderTask;

  try {
    await renderTask.promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException") return;
    throw error;
  } finally {
    if (state.renderTask === renderTask) state.renderTask = null;
  }

  if (token !== state.renderToken || pageNumber !== state.pageNumber) return;

  els.measureOverlay.setAttribute("viewBox", `0 0 ${baseViewport.width} ${baseViewport.height}`);
  els.measureOverlay.style.width = `${viewport.width}px`;
  els.measureOverlay.style.height = `${viewport.height}px`;
  renderOverlay();
}

function setPage(pageNumber) {
  if (!state.pdfDoc) return;
  const nextPage = clamp(pageNumber, 1, state.pdfDoc.numPages);
  if (nextPage === state.pageNumber) return;
  state.pageNumber = nextPage;
  state.draft = [];
  state.previewPoint = null;
  state.activeMarkup = null;
  state.selectedId = null;
  state.selectedType = null;
  renderAll();
  els.viewer.scrollTo({ top: 0, left: 0 });
  setStatus(`Opening sheet ${nextPage}...`);
  renderPage().then(() => {
    if (state.pageNumber === nextPage) {
      renderAll();
      setStatus(`Sheet ${nextPage} open.`);
    }
  }).catch(handleRenderError);
}

function setZoom(zoom) {
  state.zoom = clamp(Number(zoom.toFixed(2)), 0.5, 2.5);
  renderAll();
  renderPage().then(renderAll).catch(handleRenderError);
}

function handleViewerWheel(event) {
  if (!state.pdfDoc || event.deltaY === 0) return;

  event.preventDefault();

  const viewerRect = els.viewer.getBoundingClientRect();
  const pointerX = event.clientX - viewerRect.left + els.viewer.scrollLeft;
  const pointerY = event.clientY - viewerRect.top + els.viewer.scrollTop;
  const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
  const nextZoom = clamp(Number((state.zoom * zoomFactor).toFixed(2)), 0.5, 2.5);
  if (nextZoom === state.zoom) return;

  const worldX = pointerX / state.zoom;
  const worldY = pointerY / state.zoom;
  state.zoom = nextZoom;
  renderAll();
  renderPage()
    .then(() => {
      const nextPointerX = worldX * state.zoom;
      const nextPointerY = worldY * state.zoom;
      els.viewer.scrollLeft = Math.max(0, nextPointerX - (event.clientX - viewerRect.left));
      els.viewer.scrollTop = Math.max(0, nextPointerY - (event.clientY - viewerRect.top));
      renderAll();
    })
    .catch(handleRenderError);
}

function handleViewerPointerDown(event) {
  if (!state.pdfDoc || event.button !== 2) return;
  event.preventDefault();

  state.pan = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScrollLeft: els.viewer.scrollLeft,
    startScrollTop: els.viewer.scrollTop,
  };

  els.viewer.classList.add("is-panning");
  els.viewer.setPointerCapture?.(event.pointerId);
  els.viewer.addEventListener("pointermove", handleViewerPointerMove);
  els.viewer.addEventListener("pointerup", handleViewerPointerUp);
  els.viewer.addEventListener("pointercancel", handleViewerPointerUp);
}

function handleViewerPointerMove(event) {
  if (!state.pan || event.pointerId !== state.pan.pointerId) return;
  event.preventDefault();

  const deltaX = event.clientX - state.pan.startClientX;
  const deltaY = event.clientY - state.pan.startClientY;
  els.viewer.scrollLeft = Math.max(0, state.pan.startScrollLeft - deltaX);
  els.viewer.scrollTop = Math.max(0, state.pan.startScrollTop - deltaY);
}

function handleViewerPointerUp(event) {
  if (!state.pan || event.pointerId !== state.pan.pointerId) return;
  event.preventDefault();

  try {
    els.viewer.releasePointerCapture?.(event.pointerId);
  } catch (error) {
    console.warn("Unable to release pan pointer capture", error);
  }

  state.pan = null;
  els.viewer.classList.remove("is-panning");
  els.viewer.removeEventListener("pointermove", handleViewerPointerMove);
  els.viewer.removeEventListener("pointerup", handleViewerPointerUp);
  els.viewer.removeEventListener("pointercancel", handleViewerPointerUp);
}

function handleViewerContextMenu(event) {
  if (state.pan || state.pdfDoc) {
    event.preventDefault();
  }
}

function setTool(tool) {
  state.tool = tool;
  state.draft = [];
  state.previewPoint = null;
  state.activeMarkup = null;
  els.toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  renderAll();
  setStatus(statusForTool(tool));
}

function statusForTool(tool) {
  const labels = {
    select: "Select measurements from the plan or list.",
    scale: "Pick two known points. Scale snaps to linework and stays horizontal or vertical.",
    length: "Pick start and end points. Hold Shift for horizontal or vertical.",
    area: "Pick polygon corners, then finish the area. Hold Shift for horizontal or vertical.",
    count: "Click the plan to place count markers.",
    pen: "Drag on the plan to draw a markup.",
    highlight: "Drag on the plan to highlight plan areas.",
    text: "Click the plan to place markup text.",
  };
  return labels[tool] || "Ready";
}

function toggleSnapToLine() {
  state.snapToLine = !state.snapToLine;
  renderChrome();
  setStatus(state.snapToLine ? "Snap to line on." : "Snap to line off.");
}

function handleOverlayPointerDown(event) {
  if (state.moveDrag) return;
  if (event.button !== 0) return;
  if (!state.pdfDoc || !isFreehandMarkupTool()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-measure-id], [data-markup-id]")) return;

  const point = eventToPagePoint(event);
  if (!point) return;

  event.preventDefault();
  els.measureOverlay?.setPointerCapture?.(event.pointerId);
  state.activeMarkup = {
    id: createId(),
    pageNumber: state.pageNumber,
    type: state.tool,
    points: [point],
    color: state.markupColor,
    createdAt: new Date().toISOString(),
  };
  state.selectedId = null;
  state.selectedType = null;
  renderOverlay();
}

function handleOverlayClick(event) {
  if (state.suppressOverlayClickOnce) {
    state.suppressOverlayClickOnce = false;
    return;
  }
  if (state.moveDrag?.moved) return;
  if (event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!state.pdfDoc || target?.closest("[data-measure-id], [data-markup-id]")) return;
  if (isFreehandMarkupTool()) return;

  if (state.tool === "text") {
    const point = eventToPagePoint(event);
    if (point) addTextMarkup(point);
    return;
  }

  const point = eventToMeasurementPoint(event, { constrain: event.shiftKey });
  if (!point) return;
  state.previewPoint = null;

  if (state.tool === "scale") {
    state.draft.push(point);
    if (state.draft.length === 2) openScaleDialog();
  } else if (state.tool === "length") {
    state.draft.push(point);
    if (state.draft.length === 2) finishDraft();
  } else if (state.tool === "area") {
    if (event.detail > 1) return;
    state.draft.push(point);
  } else if (state.tool === "count") {
    addCount(point);
  } else {
    state.selectedId = null;
    state.selectedType = null;
  }

  renderAll();
}

function handleOverlayDoubleClick(event) {
  if (state.tool === "area" && state.draft.length >= 3) {
    event.preventDefault();
    finishDraft();
  }
}

function handleOverlayPointerMove(event) {
  if (state.moveDrag) {
    updateMoveDrag(event);
    return;
  }
  if (state.activeMarkup) {
    addActiveMarkupPoint(event);
    return;
  }

  if (!state.pdfDoc || !canPreviewCurrentTool()) return;
  const point = eventToMeasurementPoint(event, { constrain: event.shiftKey });
  if (!point) return;
  state.previewPoint = point;
  renderOverlay();
}

function clearPreviewPoint() {
  if (state.activeMarkup) return;
  if (!state.previewPoint) return;
  state.previewPoint = null;
  renderOverlay();
}

function addActiveMarkupPoint(event) {
  const point = eventToPagePoint(event);
  if (!point) return;

  const points = state.activeMarkup.points;
  const previous = points.at(-1);
  if (previous && distance(previous, point) < scaled(2)) return;

  points.push(point);
  renderOverlay();
}

function finishActiveMarkup(event) {
  if (state.moveDrag) {
    finishMoveDrag(event);
    return;
  }
  if (!state.activeMarkup) return;
  try {
    els.measureOverlay?.releasePointerCapture?.(event.pointerId);
  } catch (error) {
    console.warn("Unable to release markup pointer capture", error);
  }

  const markup = state.activeMarkup;
  state.activeMarkup = null;
  if (markup.points.length >= 2) {
    state.markups.push(markup);
    state.selectedId = markup.id;
    state.selectedType = "markup";
    setStatus(`${capitalize(markup.type)} markup added.`);
  }
  renderAll();
}

function cancelActiveMarkup() {
  if (state.moveDrag) {
    cancelMoveDrag();
    return;
  }
  if (!state.activeMarkup) return;
  state.activeMarkup = null;
  renderOverlay();
}

function handleOverlayContextMenu(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-measure-id], [data-markup-id]")) {
    event.preventDefault();
  }
}

function isFreehandMarkupTool() {
  return ["pen", "highlight"].includes(state.tool);
}

function eventToPagePoint(event) {
  const rect = els.measureOverlay.getBoundingClientRect();
  const viewBox = els.measureOverlay.viewBox.baseVal;
  if (!rect.width || !rect.height || !viewBox.width || !viewBox.height) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function eventToMeasurementPoint(event, options = {}) {
  const point = eventToPagePoint(event);
  if (!point) return null;

  let measurementPoint = point;
  if (canSnapCurrentTool()) {
    measurementPoint = snapPointToLine(measurementPoint) || measurementPoint;
  }
  if (shouldConstrainCurrentTool(options)) {
    measurementPoint = constrainPointToAxis(measurementPoint);
  }
  return measurementPoint;
}

function canSnapCurrentTool() {
  return state.tool === "scale" || (state.snapToLine && ["length", "area"].includes(state.tool));
}

function shouldConstrainCurrentTool(options = {}) {
  return state.tool === "scale" || Boolean(options.constrain);
}

function canPreviewCurrentTool() {
  return ["scale", "length", "area"].includes(state.tool) && state.draft.length > 0 && !isDraftComplete();
}

function isDraftComplete() {
  return ["scale", "length"].includes(state.tool) && state.draft.length >= 2;
}

function constrainPointToAxis(point) {
  const anchor = state.draft.at(-1);
  if (!anchor) return point;

  const deltaX = point.x - anchor.x;
  const deltaY = point.y - anchor.y;
  return Math.abs(deltaX) >= Math.abs(deltaY)
    ? { x: point.x, y: anchor.y }
    : { x: anchor.x, y: point.y };
}

function snapPointToLine(point) {
  const viewBox = els.measureOverlay.viewBox.baseVal;
  const canvas = els.pdfCanvas;
  if (!viewBox.width || !viewBox.height || !canvas.width || !canvas.height) return null;

  const scaleX = canvas.width / viewBox.width;
  const scaleY = canvas.height / viewBox.height;
  const centerX = point.x * scaleX;
  const centerY = point.y * scaleY;
  const radius = Math.max(3, Math.round(SNAP_RADIUS_PX * (window.devicePixelRatio || 1)));
  const left = Math.max(0, Math.round(centerX - radius));
  const top = Math.max(0, Math.round(centerY - radius));
  const right = Math.min(canvas.width, Math.round(centerX + radius + 1));
  const bottom = Math.min(canvas.height, Math.round(centerY + radius + 1));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;

  let imageData;
  try {
    imageData = els.pdfCanvas.getContext("2d").getImageData(left, top, width, height);
  } catch (error) {
    console.warn("Unable to read drawing pixels for snap", error);
    return null;
  }

  let best = null;
  let bestDistance = Infinity;
  const { data } = imageData;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isSnapLinePixel(data[index], data[index + 1], data[index + 2], data[index + 3])) continue;

      const pixelX = left + x;
      const pixelY = top + y;
      const distance = (pixelX - centerX) ** 2 + (pixelY - centerY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: pixelX / scaleX, y: pixelY / scaleY };
      }
    }
  }

  return best;
}

function isSnapLinePixel(red, green, blue, alpha) {
  if (alpha < 80) return false;
  return (red + green + blue) / 3 < SNAP_DARKNESS_THRESHOLD;
}

function openScaleDialog() {
  openScaleDialogForMode(state.draft.length >= 2 ? "measured" : "manual");
}

function openScaleDialogForMode(mode) {
  const distance = polylineLength(state.draft);
  const measuredSheetLength = formatMeasuredSheetLength(distance);
  const activeScale = currentScale();
  state.scaleMode = mode;
  els.scaleMeasured.textContent = distance
    ? `Drawing distance: ${distance.toFixed(1)} page units (${measuredSheetLength} on sheet)`
    : "Enter a printed plan scale such as 1/4\" = 1 ft.";
  els.scaleUnit.value = state.projectUnit;
  els.manualScaleUnit.value = state.projectUnit;
  if (activeScale) {
    els.scaleLength.value = formatScaleInput(activeScale.realLength, activeScale.unit);
    els.manualScaleLength.value = formatScaleInput(activeScale.realLength, activeScale.unit);
    if (activeScale.sheetLengthInches) {
      els.sheetLength.value = formatSheetLengthInput(activeScale.sheetLengthInches, activeScale.sheetUnit || "in");
      els.sheetUnit.value = activeScale.sheetUnit || "in";
    }
  } else {
    els.sheetLength.value = "1/4";
    els.sheetUnit.value = "in";
    els.manualScaleLength.value = "1";
  }
  els.applyScaleToProject.checked = false;
  setScaleMode(mode);
  if (typeof els.scaleDialog.showModal === "function") {
    els.scaleDialog.showModal();
  } else {
    setStatus("Manual scale entry requires dialog support in this browser.");
  }
}

function closeScaleDialog() {
  els.scaleDialog.close();
  els.applyScaleToProject.checked = false;
  state.draft = [];
  state.previewPoint = null;
  renderAll();
}

function applyScale(event) {
  event.preventDefault();
  const before = createHistorySnapshot();
  const nextScale = state.scaleMode === "manual" ? buildManualScale() : buildMeasuredScale();
  if (!nextScale) return;
  const applyToProject = Boolean(els.applyScaleToProject.checked);
  if (applyToProject && state.pdfDoc?.numPages) {
    for (let pageNumber = 1; pageNumber <= state.pdfDoc.numPages; pageNumber += 1) {
      state.scales[pageNumber] = {
        ...structuredClone(nextScale),
        pageNumber,
      };
    }
  } else {
    state.scales[state.pageNumber] = nextScale;
  }
  state.draft = [];
  state.previewPoint = null;
  els.applyScaleToProject.checked = false;
  els.scaleDialog.close();
  pushUndoSnapshot(before);
  setStatus(applyToProject ? "Scale set for the entire project." : `Scale set for sheet ${state.pageNumber}.`);
  renderAll();
}

function buildMeasuredScale() {
  const realLength = parseScaleLength(els.scaleLength.value, state.projectUnit);
  const distance = polylineLength(state.draft);
  if (!realLength || realLength <= 0 || !distance) {
    setStatus("Enter a valid known length.");
    return null;
  }

  return {
    pageNumber: state.pageNumber,
    points: [...state.draft],
    realLength,
    unit: state.projectUnit,
    source: "measured",
    pdfUnitsPerUnit: distance / realLength,
  };
}

function buildManualScale() {
  const pageUnitsPerInch = currentPageUnitsPerInch();
  const sheetLengthInches = parseSheetLengthToInches(els.sheetLength.value, els.sheetUnit.value);
  const realLength = parseScaleLength(els.manualScaleLength.value, state.projectUnit);
  if (!pageUnitsPerInch || !sheetLengthInches || sheetLengthInches <= 0 || !realLength || realLength <= 0) {
    setStatus("Enter a valid manual scale.");
    return null;
  }

  return {
    pageNumber: state.pageNumber,
    points: [],
    realLength,
    unit: state.projectUnit,
    source: "manual",
    sheetLengthInches,
    sheetUnit: els.sheetUnit.value,
    pageUnitsPerInch,
    pdfUnitsPerUnit: (sheetLengthInches * pageUnitsPerInch) / realLength,
  };
}

function setScaleMode(mode) {
  const nextMode = mode === "manual" ? "manual" : "measured";
  const hasMeasuredDraft = state.draft.length >= 2;
  state.scaleMode = nextMode === "measured" && !hasMeasuredDraft ? "manual" : nextMode;

  const isMeasured = state.scaleMode === "measured";
  els.measuredScaleFields.hidden = !isMeasured;
  els.manualScaleFields.hidden = isMeasured;
  els.scaleModeMeasured.classList.toggle("active", isMeasured);
  els.scaleModeManual.classList.toggle("active", !isMeasured);
  els.scaleModeMeasured.setAttribute("aria-pressed", String(isMeasured));
  els.scaleModeManual.setAttribute("aria-pressed", String(!isMeasured));
  els.scaleMeasured.textContent = isMeasured
    ? `Drawing distance: ${polylineLength(state.draft).toFixed(1)} page units (${formatMeasuredSheetLength(polylineLength(state.draft))} on sheet)`
    : "Enter a printed plan scale such as 1/4\" = 1 ft.";
  syncScaleLengthInput();
}

function setProjectMeasurementUnit(unit, options = {}) {
  const nextUnit = normalizeProjectUnit(unit);
  const previousUnit = normalizeProjectUnit(state.projectUnit);
  state.projectUnit = nextUnit;

  if (options.updateInputs !== false) {
    els.scaleUnit.value = nextUnit;
    els.manualScaleUnit.value = nextUnit;
    els.projectUnitSelect.value = nextUnit;
  }

  if (options.convertScales !== false && previousUnit !== nextUnit) {
    Object.keys(state.scales).forEach((pageKey) => {
      const scale = state.scales[pageKey];
      if (!scale?.unit) return;
      state.scales[pageKey] = convertScaleUnit(scale, nextUnit);
    });
  }

  syncScaleLengthInput();
}

function normalizeProjectUnit(unit) {
  return ["ft", "ft-in", "in", "m", "cm"].includes(unit) ? unit : "ft";
}

function inferProjectUnitFromScales(scales) {
  const firstScale = Object.values(scales || {}).find((scale) => scale?.unit);
  return normalizeProjectUnit(firstScale?.unit || "ft");
}

function convertScaleUnit(scale, nextUnit) {
  const currentUnit = normalizeProjectUnit(scale.unit);
  const targetUnit = normalizeProjectUnit(nextUnit);
  if (currentUnit === targetUnit) return scale;

  const feetPerCurrentUnit = feetPerUnit(currentUnit);
  const feetPerTargetUnit = feetPerUnit(targetUnit);
  const valueInFeet = scale.realLength * feetPerCurrentUnit;
  const pdfUnitsPerFoot = scale.pdfUnitsPerUnit / feetPerCurrentUnit;

  return {
    ...scale,
    unit: targetUnit,
    realLength: valueInFeet / feetPerTargetUnit,
    pdfUnitsPerUnit: pdfUnitsPerFoot * feetPerTargetUnit,
  };
}

function feetPerUnit(unit) {
  switch (unit) {
    case "in":
      return 1 / 12;
    case "m":
      return 3.280839895013123;
    case "cm":
      return 0.03280839895013123;
    case "ft":
    case "ft-in":
    default:
      return 1;
  }
}

function finishDraft() {
  if (state.tool === "length" && state.draft.length >= 2) {
    addMeasurement({
      type: "length",
      label: nextLabel("Length"),
      points: [...state.draft],
      color: COLORS.length,
    });
  }

  if (state.tool === "area" && state.draft.length >= 3) {
    addMeasurement({
      type: "area",
      label: nextLabel("Area"),
      points: [...state.draft],
      color: COLORS.area,
    });
  }

  state.draft = [];
  state.previewPoint = null;
  renderAll();
}

function undoDraftPoint() {
  state.draft.pop();
  state.previewPoint = null;
  renderAll();
}

function addMeasurement(partial) {
  const before = createHistorySnapshot();
  const measurement = {
    id: createId(),
    pageNumber: state.pageNumber,
    createdAt: new Date().toISOString(),
    ...partial,
  };
  state.measurements.push(measurement);
  state.selectedId = measurement.id;
  state.selectedType = "measurement";
  state.selectedPointIndex = null;
  pushUndoSnapshot(before);
  setStatus(`${capitalize(partial.type)} added.`);
}

function addCount(point) {
  const before = createHistorySnapshot();
  const label = defaultCountLabel(state.countSymbol);
  let measurement = selectedMeasurement();
  if (!(measurement?.type === "count" && measurement.pageNumber === state.pageNumber)) {
    measurement = state.measurements.find((item) =>
      item.type === "count"
      && item.pageNumber === state.pageNumber
      && item.label === label
      && (item.symbol || "circle") === state.countSymbol
      && (item.color || COLORS.count) === state.countColor);
  }

  if (!measurement) {
    measurement = {
      id: createId(),
      pageNumber: state.pageNumber,
      type: "count",
      label,
      points: [],
      symbol: state.countSymbol,
      color: state.countColor,
      createdAt: new Date().toISOString(),
    };
    state.measurements.push(measurement);
  }

  measurement.points.push(point);
  state.selectedId = measurement.id;
  state.selectedType = "measurement";
  state.selectedPointIndex = measurement.points.length - 1;
  pushUndoSnapshot(before);
  setStatus(`${label} count: ${measurement.points.length}`);
}

function addTextMarkup(point) {
  const text = requestMarkupText();
  if (!text) {
    setStatus("Text markup cancelled.");
    return;
  }
  const before = createHistorySnapshot();

  const markup = {
    id: createId(),
    pageNumber: state.pageNumber,
    type: "text",
    text,
    points: [point],
    color: state.markupColor,
    createdAt: new Date().toISOString(),
  };
  state.markups.push(markup);
  state.selectedId = markup.id;
  state.selectedType = "markup";
  pushUndoSnapshot(before);
  renderAll();
  setStatus("Text markup added.");
}

function deleteSelected() {
  if (!state.selectedId) return;
  const before = createHistorySnapshot();
  if (state.selectedType === "markup") {
    state.markups = state.markups.filter((item) => item.id !== state.selectedId);
    setStatus("Markup deleted.");
  } else {
    const measurement = selectedMeasurement();
    if (measurement?.type === "count" && state.selectedPointIndex !== null) {
      measurement.points.splice(state.selectedPointIndex, 1);
      if (!measurement.points.length) {
        state.measurements = state.measurements.filter((item) => item.id !== measurement.id);
        setStatus("Count set deleted.");
      } else {
        setStatus("Count item deleted.");
      }
    } else if (measurement?.type === "count") {
      state.measurements = state.measurements.filter((item) => item.id !== state.selectedId);
      setStatus("Count set deleted.");
    } else {
      state.measurements = state.measurements.filter((item) => item.id !== state.selectedId);
      setStatus("Measurement deleted.");
    }
  }
  state.selectedId = null;
  state.selectedType = null;
  state.selectedPointIndex = null;
  pushUndoSnapshot(before);
  renderAll();
}

function clearMeasurements() {
  if (!state.measurements.length) return;
  const before = createHistorySnapshot();
  state.measurements = [];
  state.selectedId = null;
  state.selectedType = null;
  state.draft = [];
  state.previewPoint = null;
  pushUndoSnapshot(before);
  renderAll();
  setStatus("Measurements cleared.");
}

function clearMarkups() {
  if (!state.markups.length) return;
  const before = createHistorySnapshot();
  state.markups = [];
  state.activeMarkup = null;
  if (state.selectedType === "markup") {
    state.selectedId = null;
    state.selectedType = null;
  }
  pushUndoSnapshot(before);
  renderAll();
  setStatus("Markups cleared.");
}

function createProjectSnapshot() {
  return {
    app: "plan-takeoff",
    version: 1,
    id: state.savedProjectId || undefined,
    savedAt: new Date().toISOString(),
    projectName: state.projectName,
    projectUnit: state.projectUnit,
    pdfName: state.pdfName,
    pdfDataBase64: state.pdfDataBase64,
    pageNumber: state.pageNumber,
    zoom: state.zoom,
    scales: state.scales,
    scale: currentScale() || null,
    measurements: state.measurements,
    markups: state.markups,
    countSymbol: state.countSymbol,
    countColor: state.countColor,
    markupColor: state.markupColor,
  };
}

function createHistorySnapshot() {
  return {
    pageNumber: state.pageNumber,
    zoom: state.zoom,
    tool: state.tool,
    snapToLine: state.snapToLine,
    measurements: structuredClone(state.measurements),
    markups: structuredClone(state.markups),
    scales: structuredClone(state.scales),
    projectUnit: state.projectUnit,
    selectedId: state.selectedId,
    selectedType: state.selectedType,
    selectedPointIndex: state.selectedPointIndex,
    countSymbol: state.countSymbol,
    countColor: state.countColor,
    markupColor: state.markupColor,
  };
}

function historyFingerprint(snapshot) {
  return JSON.stringify(snapshot);
}

function pushUndoSnapshot(snapshot) {
  if (!snapshot) return;
  const currentSnapshot = createHistorySnapshot();
  if (historyFingerprint(snapshot) === historyFingerprint(currentSnapshot)) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
}

function applyHistorySnapshot(snapshot) {
  state.restoringHistory = true;
  state.pageNumber = clamp(Number(snapshot.pageNumber) || 1, 1, state.pdfDoc?.numPages || 1);
  state.zoom = clamp(Number(snapshot.zoom) || 1, 0.5, 2.5);
  state.tool = snapshot.tool || "select";
  state.snapToLine = Boolean(snapshot.snapToLine);
  state.measurements = Array.isArray(snapshot.measurements)
    ? snapshot.measurements.map((measurement) => normalizeMeasurement(measurement))
    : [];
  state.markups = Array.isArray(snapshot.markups) ? snapshot.markups : [];
  state.scales = normalizeScalesPayload(snapshot.scales || null);
  setProjectMeasurementUnit(snapshot.projectUnit || inferProjectUnitFromScales(state.scales), {
    convertScales: false,
  });
  state.selectedId = snapshot.selectedId || null;
  state.selectedType = snapshot.selectedType || null;
  state.selectedPointIndex = Number.isInteger(snapshot.selectedPointIndex) ? snapshot.selectedPointIndex : null;
  state.countSymbol = normalizeCountSymbol(snapshot.countSymbol);
  state.countColor = snapshot.countColor || COLORS.count;
  state.markupColor = snapshot.markupColor || "#e4572e";
  state.draft = [];
  state.previewPoint = null;
  state.activeMarkup = null;
  els.countColor.value = state.countColor;
  els.markupColor.value = state.markupColor;
  els.toolButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === state.tool);
  });
  renderPage().then(() => {
    state.restoringHistory = false;
    renderAll();
  }).catch((error) => {
    state.restoringHistory = false;
    handleRenderError(error);
  });
}

function undoAction() {
  if (!state.undoStack.length) return;
  const previous = state.undoStack.pop();
  state.redoStack.push(createHistorySnapshot());
  applyHistorySnapshot(previous);
  setStatus("Undid last change.");
}

function redoAction() {
  if (!state.redoStack.length) return;
  const next = state.redoStack.pop();
  state.undoStack.push(createHistorySnapshot());
  applyHistorySnapshot(next);
  setStatus("Redid change.");
}

function selectMeasurement(id, pointIndex = null, options = {}) {
  state.selectedId = id;
  state.selectedType = "measurement";
  state.selectedPointIndex = pointIndex;
  state.suppressOverlayClickOnce = Boolean(options.suppressOverlayClickOnce);
  renderAll();
}

function selectMarkup(id, options = {}) {
  state.selectedId = id;
  state.selectedType = "markup";
  state.selectedPointIndex = null;
  state.suppressOverlayClickOnce = Boolean(options.suppressOverlayClickOnce);
  renderAll();
}

function createProjectFingerprint(project = createProjectSnapshot()) {
  const { savedAt, ...stableProject } = project;
  return JSON.stringify(stableProject);
}

function updateDirtyState() {
  if (!state.pdfDoc || !state.pdfDataBase64) {
    state.dirty = false;
    return;
  }
  state.dirty = createProjectFingerprint() !== state.lastSavedFingerprint;
}

function markSessionSaved() {
  state.lastSavedFingerprint = createProjectFingerprint();
  state.dirty = false;
  persistSessionState();
}

function scheduleSessionSave() {
  if (state.sessionSaveTimer) window.clearTimeout(state.sessionSaveTimer);
  state.sessionSaveTimer = window.setTimeout(() => {
    state.sessionSaveTimer = null;
    persistSessionState();
  }, 180);
}

function startMoveDrag(event, drag) {
  const point = eventToPagePoint(event);
  if (!point) return;

  event.preventDefault();
  els.measureOverlay?.setPointerCapture?.(event.pointerId);
  state.moveDrag = {
    ...drag,
    pointerId: event.pointerId,
    lastPoint: point,
    moved: false,
    beforeSnapshot: createHistorySnapshot(),
  };
}

function updateMoveDrag(event) {
  if (!state.moveDrag || event.pointerId !== state.moveDrag.pointerId) return;
  const point = eventToPagePoint(event);
  if (!point) return;

  const deltaX = point.x - state.moveDrag.lastPoint.x;
  const deltaY = point.y - state.moveDrag.lastPoint.y;
  if (!deltaX && !deltaY) return;

  if (state.moveDrag.type === "count-item") {
    const measurement = state.measurements.find((item) => item.id === state.moveDrag.measurementId);
    const itemPoint = measurement?.points?.[state.moveDrag.pointIndex];
    if (itemPoint) {
      itemPoint.x += deltaX;
      itemPoint.y += deltaY;
    }
  }

  if (state.moveDrag.type === "markup") {
    const markup = state.markups.find((item) => item.id === state.moveDrag.markupId);
    if (markup) {
      markup.points = markup.points.map((itemPoint) => ({
        x: itemPoint.x + deltaX,
        y: itemPoint.y + deltaY,
      }));
    }
  }

  state.moveDrag.lastPoint = point;
  state.moveDrag.moved = true;
  renderAll();
}

function finishMoveDrag(event) {
  if (!state.moveDrag || event.pointerId !== state.moveDrag.pointerId) return;
  const drag = state.moveDrag;
  const dragType = drag.type;
  try {
    els.measureOverlay?.releasePointerCapture?.(event.pointerId);
  } catch (error) {
    console.warn("Unable to release move pointer capture", error);
  }

  const moved = drag.moved;
  state.moveDrag = null;
  if (moved) {
    pushUndoSnapshot(drag.beforeSnapshot);
    setStatus(dragType === "markup" ? "Markup moved." : "Count item moved.");
  } else if (dragType === "markup") {
    selectMarkup(drag.markupId, { suppressOverlayClickOnce: true });
    return;
  } else if (dragType === "count-item") {
    selectMeasurement(drag.measurementId, drag.pointIndex, { suppressOverlayClickOnce: true });
    return;
  }
  renderAll();
}

function cancelMoveDrag() {
  state.moveDrag = null;
  renderAll();
}

function persistSessionState() {
  if (!state.pdfDoc || !state.pdfDataBase64) {
    deleteSessionState().catch((error) => {
      console.warn("Unable to clear session state", error);
    });
    return;
  }

  const payload = {
    key: sessionStorageKey,
    project: createProjectSnapshot(),
    dirty: state.dirty,
    lastSavedFingerprint: state.lastSavedFingerprint,
    updatedAt: Date.now(),
  };

  writeSessionState(payload).catch((error) => {
    console.warn("Unable to persist session state", error);
  });
}

function handleBeforeUnload(event) {
  persistSessionState();
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

function openSessionDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable."));
      return;
    }

    const request = window.indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Unable to open session database.")));
  });
}

async function writeSessionState(payload) {
  try {
    const db = await openSessionDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SESSION_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SESSION_STORE_NAME);
      store.put(payload);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error || new Error("Unable to write session state.")));
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("Session write aborted.")));
    });
    db.close();
  } catch (error) {
    const fallback = JSON.stringify(payload);
    window.localStorage.setItem(sessionStorageKey, fallback);
  }
}

async function readSessionState() {
  try {
    const db = await openSessionDb();
    const payload = await new Promise((resolve, reject) => {
      const transaction = db.transaction(SESSION_STORE_NAME, "readonly");
      const store = transaction.objectStore(SESSION_STORE_NAME);
      const request = store.get(sessionStorageKey);
      request.addEventListener("success", () => resolve(request.result || null));
      request.addEventListener("error", () => reject(request.error || new Error("Unable to read session state.")));
    });
    db.close();
    if (payload) return payload;
  } catch (error) {
    console.warn("IndexedDB restore failed, trying localStorage fallback.", error);
  }

  const fallback = window.localStorage.getItem(sessionStorageKey) || "";
  return fallback ? JSON.parse(fallback) : null;
}

async function deleteSessionState() {
  try {
    const db = await openSessionDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SESSION_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SESSION_STORE_NAME);
      store.delete(sessionStorageKey);
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error || new Error("Unable to delete session state.")));
      transaction.addEventListener("abort", () => reject(transaction.error || new Error("Session delete aborted.")));
    });
    db.close();
  } finally {
    window.localStorage.removeItem(sessionStorageKey);
  }
}

async function restoreSessionState() {
  try {
    const payload = await readSessionState();
    if (!payload) return;
    const project = payload.project || payload;
    await hydrateProject(project, {
      fallbackPdfName: "Restored drawing.pdf",
      statusMessage: `Restored ${project.pdfName || "previous drawing"} after refresh.`,
      markSaved: false,
      restoredDirty: Boolean(payload.dirty),
      restoredLastSavedFingerprint: typeof payload.lastSavedFingerprint === "string" ? payload.lastSavedFingerprint : "",
    });
  } catch (error) {
    console.warn("Unable to restore previous session", error);
    deleteSessionState().catch(() => {});
  }
}

async function hydrateProject(project, options = {}) {
  if (project.app !== "plan-takeoff" || !project.pdfDataBase64) {
    throw new Error("Unsupported takeoff file.");
  }

  const pdfjs = getPdfJs();
  if (!pdfjs) {
    setStatus("PDF rendering library is unavailable.");
    return;
  }

  const pdfBytes = base64ToUint8Array(project.pdfDataBase64);
  const loadingTask = pdfjs.getDocument({ data: pdfBytes });
  const pdfDoc = await loadingTask.promise;

  state.pdfDoc = pdfDoc;
  state.pdfName = project.pdfName || options.fallbackPdfName || "Drawing.pdf";
  state.projectName = project.projectName || fileStem(state.pdfName) || "Untitled takeoff";
  state.pdfDataBase64 = project.pdfDataBase64;
  state.savedProjectId = project.id || "";
  state.pageNumber = clamp(Number(project.pageNumber) || 1, 1, pdfDoc.numPages);
  state.zoom = clamp(Number(project.zoom) || 1, 0.5, 2.5);
  state.draft = [];
  state.previewPoint = null;
  state.measurements = Array.isArray(project.measurements)
    ? project.measurements.map((measurement) => normalizeMeasurement(measurement))
    : [];
  state.markups = Array.isArray(project.markups) ? project.markups : [];
  state.activeMarkup = null;
  state.selectedId = null;
  state.selectedType = null;
  state.selectedPointIndex = null;
  state.scales = normalizeScalesPayload(project.scales || project.scale || null);
  state.projectUnit = normalizeProjectUnit(project.projectUnit || inferProjectUnitFromScales(state.scales));
  state.undoStack = [];
  state.redoStack = [];
  state.pageMetrics = {};
  state.countSymbol = normalizeCountSymbol(project.countSymbol);
  state.countColor = project.countColor || COLORS.count;
  state.markupColor = project.markupColor || "#e4572e";

  els.countColor.value = state.countColor;
  els.markupColor.value = state.markupColor;
  els.scaleUnit.value = state.projectUnit;
  els.manualScaleUnit.value = state.projectUnit;
  els.projectUnitSelect.value = state.projectUnit;
  syncScaleLengthInput();

  await buildPageList();
  await renderPage();
  setTool("select");
  if (options.markSaved) {
    state.lastSavedFingerprint = createProjectFingerprint();
    state.dirty = false;
  } else {
    state.lastSavedFingerprint = options.restoredLastSavedFingerprint || "";
    state.dirty = Boolean(options.restoredDirty);
    updateDirtyState();
    if (options.restoredDirty) state.dirty = true;
  }
  renderAll();
  if (options.statusMessage) setStatus(options.statusMessage);
}

function handleSelectionSubmit(event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form || form.id !== "renameMeasurementForm") return;
  event.preventDefault();
  renameSelectedMeasurement();
}

function renameSelectedMeasurement() {
  const measurement = selectedMeasurement();
  const input = els.selectionPanel.querySelector("#renameMeasurementInput");
  const nextLabel = input?.value?.trim();
  if (!measurement || !nextLabel) {
    setStatus("Enter a measurement name.");
    return;
  }

  const before = createHistorySnapshot();
  measurement.label = nextLabel;
  pushUndoSnapshot(before);
  renderAll();
  setStatus("Measurement renamed.");
}

function renderAll() {
  updateDirtyState();
  renderChrome();
  renderOverlay();
  renderMarkupsList();
  renderMeasurementsList();
  renderSelection();
  renderTotals();
  scheduleSessionSave();
}

function renderChrome() {
  const pageTotal = state.pdfDoc?.numPages || 0;
  const hasPlan = Boolean(state.pdfDoc);
  els.projectNameDisplay.textContent = state.projectName || "Untitled project";
  els.fileName.textContent = state.pdfName || "No drawing loaded";
  els.projectUnitSelect.value = state.projectUnit;
  els.sheetCount.textContent = String(pageTotal);
  els.pageLabel.textContent = `Page ${pageTotal ? state.pageNumber : 0} / ${pageTotal}`;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  els.prevPage.disabled = !state.pdfDoc || state.pageNumber <= 1;
  els.nextPage.disabled = !state.pdfDoc || state.pageNumber >= pageTotal;
  els.zoomOut.disabled = !state.pdfDoc || state.zoom <= 0.5;
  els.zoomIn.disabled = !state.pdfDoc || state.zoom >= 2.5;
  els.undoAction.disabled = !state.undoStack.length;
  els.redoAction.disabled = !state.redoStack.length;
  els.saveProjectButton.disabled = !state.pdfDoc || !state.pdfDataBase64;
  els.saveAsProjectButton.disabled = !state.pdfDoc || !state.pdfDataBase64;
  els.undoPoint.disabled = !state.draft.length;
  els.finishMeasure.disabled = !canFinishDraft();
  els.clearMeasurements.disabled = !state.measurements.length;
  els.clearMarkups.disabled = !state.markups.length;
  els.exportCsv.disabled = !state.measurements.length;
  els.deleteSelected.disabled = !state.selectedId;
  els.snapToggle.classList.toggle("active", state.snapToLine);
  els.snapToggle.setAttribute("aria-pressed", String(state.snapToLine));
  const activeScale = currentScale();
  els.scaleBadge.textContent = activeScale
    ? activeScale.source === "manual" && activeScale.sheetLengthInches
      ? `${formatSheetLength(activeScale.sheetLengthInches, activeScale.sheetUnit || "in")} = ${formatScaleLength(activeScale.realLength, activeScale.unit)}`
      : `${formatScaleLength(activeScale.realLength, activeScale.unit)} calibrated`
    : "Scale not set";
  els.scaleStatus.textContent = activeScale
    ? scaleStatusText(state.pageNumber)
    : `Set scale for sheet ${state.pageNumber} from two known points on the plan.`;
  els.draftText.textContent = draftSummary();
  els.viewer.classList.toggle("has-plan", hasPlan);
  els.emptyState.hidden = hasPlan;
  els.pageStage.hidden = !hasPlan;
  els.measureOverlay.className.baseVal = `measure-overlay is-${state.tool}`;
  syncCountControls();

  [...els.pagesList.querySelectorAll(".page-thumb")].forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.page) === state.pageNumber);
  });
}

function renderOverlay() {
  els.measureOverlay.innerHTML = "";
  if (!state.pdfDoc) return;

  const visibleMeasurements = state.measurements.filter((item) => item.pageNumber === state.pageNumber);
  visibleMeasurements.forEach((measurement) => {
    els.measureOverlay.append(renderMeasurement(measurement));
  });

  const visibleMarkups = state.markups.filter((item) => item.pageNumber === state.pageNumber);
  visibleMarkups.forEach((markup) => {
    els.measureOverlay.append(renderMarkup(markup));
  });

  if (state.activeMarkup) {
    els.measureOverlay.append(renderMarkup(state.activeMarkup, { isDraft: true }));
  }

  if (state.draft.length) {
    els.measureOverlay.append(renderDraft());
  }
}

function renderMeasurement(measurement) {
  const group = svg("g", {
    class: measurement.id === state.selectedId && state.selectedType === "measurement" ? "selected" : "",
    "data-measure-id": measurement.id,
    style: `color: ${measurement.color}`,
  });
  if (measurement.type !== "count") {
    group.addEventListener("click", (event) => {
      if (state.moveDrag?.moved) return;
      event.stopPropagation();
      selectMeasurement(measurement.id, null);
    });
  }

  if (measurement.type === "length") {
    const path = svg("polyline", {
      class: "measurement-path",
      points: pointsAttribute(measurement.points),
      stroke: measurement.color,
      "stroke-width": "3",
    });
    const hit = svg("polyline", {
      class: "measurement-hit",
      points: pointsAttribute(measurement.points),
    });
    group.append(path, hit);
    renderPoints(group, measurement.points, measurement.color);
    const labelPoint = midpoint(measurement.points);
    group.append(
      svg("text", {
        class: "measurement-label",
        x: labelPoint.x,
        y: labelPoint.y - scaled(8),
        "font-size": scaled(13),
      }, formatMeasurementValue(measurement)),
    );
  }

  if (measurement.type === "area") {
    const polygon = svg("polygon", {
      class: "measurement-fill",
      points: pointsAttribute(measurement.points),
      fill: measurement.color,
      stroke: measurement.color,
      "stroke-width": "3",
    });
    const hit = svg("polygon", {
      class: "measurement-hit",
      points: pointsAttribute(measurement.points),
    });
    group.append(polygon, hit);
    renderPoints(group, measurement.points, measurement.color);
    const labelPoint = polygonCentroid(measurement.points);
    group.append(
      svg("text", {
        class: "measurement-label",
        x: labelPoint.x,
        y: labelPoint.y,
        "text-anchor": "middle",
        "font-size": scaled(13),
      }, formatMeasurementValue(measurement)),
    );
  }

  if (measurement.type === "count") {
    measurement.points.forEach((point, index) => {
      const isItemSelected = measurement.id === state.selectedId
        && state.selectedType === "measurement"
        && (state.selectedPointIndex === null || state.selectedPointIndex === index);
      const markerGroup = svg("g", {
        class: isItemSelected ? "count-item-selected" : "",
        style: `color: ${measurement.color}`,
      });
      markerGroup.append(
        svg("circle", {
          class: "count-hit",
          cx: point.x,
          cy: point.y,
          r: 14,
          fill: "none",
          stroke: "transparent",
          "stroke-width": 28,
        }),
      );
      if (isItemSelected) {
        markerGroup.append(renderCountSelectionIndicator(point));
      }
      markerGroup.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (state.tool === "select") {
          state.selectedId = measurement.id;
          state.selectedType = "measurement";
          state.selectedPointIndex = index;
          startMoveDrag(event, {
            type: "count-item",
            measurementId: measurement.id,
            pointIndex: index,
          });
        }
      });
      markerGroup.addEventListener("click", (event) => {
        if (state.moveDrag?.moved) return;
        event.stopPropagation();
        selectMeasurement(measurement.id, index);
      });
      markerGroup.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      markerGroup.append(...renderCountSymbol(measurement, point, index));
      markerGroup.append(
        svg("text", {
          class: "count-number",
          x: point.x + 11,
          y: point.y - 9,
          "font-size": 7.5,
          "text-anchor": "start",
        }, String(index + 1)),
      );
      group.append(markerGroup);
    });
  }

  return group;
}

function renderMarkup(markup, options = {}) {
  const group = svg("g", {
    class: markup.id === state.selectedId && state.selectedType === "markup" ? "selected" : "",
    "data-markup-id": markup.id,
    style: `color: ${markup.color}`,
  });

  group.addEventListener("click", (event) => {
    if (state.moveDrag?.moved) return;
    event.stopPropagation();
    selectMarkup(markup.id);
  });

  group.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || options.isDraft) return;
    event.stopPropagation();
    if (state.tool === "select") {
      state.selectedId = markup.id;
      state.selectedType = "markup";
      state.selectedPointIndex = null;
      startMoveDrag(event, {
        type: "markup",
        markupId: markup.id,
      });
    }
  });

  if (markup.type === "pen" || markup.type === "highlight") {
    const path = svg("polyline", {
      class: markup.type === "highlight" ? "markup-highlight" : "markup-path",
      points: pointsAttribute(markup.points),
      stroke: markup.color,
      "stroke-width": markup.type === "highlight" ? "10" : "3",
    });
    const hit = svg("polyline", {
      class: "markup-hit",
      points: pointsAttribute(markup.points),
    });
    group.append(path);
    if (!options.isDraft) group.append(hit);
  }

  if (markup.type === "text") {
    const [point] = markup.points;
    const text = markup.text || "Note";
    const fontSize = scaled(14);
    const padX = scaled(8);
    const padY = scaled(5);
    const width = Math.max(scaled(48), text.length * scaled(7.5) + padX * 2);
    const height = fontSize + padY * 2;

    group.append(
      svg("rect", {
        class: "markup-text-box",
        x: point.x,
        y: point.y - height,
        width,
        height,
        rx: scaled(4),
        fill: markup.color,
      }),
      svg("text", {
        class: "markup-text",
        x: point.x + padX,
        y: point.y - padY,
        "font-size": fontSize,
      }, text),
    );
  }

  if (!options.isDraft && markup.id === state.selectedId && state.selectedType === "markup") {
    group.append(renderMarkupSelectionIndicator(markup));
  }

  return group;
}

function renderCountSelectionIndicator(point) {
  return svg("circle", {
    class: "selection-indicator",
    cx: point.x,
    cy: point.y,
    r: 16,
  });
}

function renderMarkupSelectionIndicator(markup) {
  if (markup.type === "text") {
    const [point] = markup.points;
    const text = markup.text || "Note";
    const fontSize = scaled(14);
    const padX = scaled(8);
    const padY = scaled(5);
    const width = Math.max(scaled(48), text.length * scaled(7.5) + padX * 2);
    const height = fontSize + padY * 2;
    const inset = scaled(4);
    return svg("rect", {
      class: "selection-indicator",
      x: point.x - inset,
      y: point.y - height - inset,
      width: width + inset * 2,
      height: height + inset * 2,
      rx: scaled(6),
    });
  }

  return svg(markup.type === "highlight" ? "polyline" : "polyline", {
    class: "selection-indicator",
    points: pointsAttribute(markup.points),
  });
}

function renderCountSymbol(measurement, point, index = 0) {
  const radius = 9;
  const innerRadius = 3.25;
  const strokeWidth = 2.25;
  const symbol = normalizeCountSymbol(measurement.symbol);
  const symbolOption = countSymbolOption(symbol);
  const nodes = [];
  const labelSize = 7;

  if (symbolOption.imageUrl) {
    const imageSize = 24;
    const maskId = `count-mask-${measurement.id}-${index}`;
    const defs = svg("defs");
    const mask = svg("mask", {
      id: maskId,
      "mask-type": "alpha",
      maskUnits: "userSpaceOnUse",
      x: point.x - imageSize / 2,
      y: point.y - imageSize / 2,
      width: imageSize,
      height: imageSize,
    });
    mask.append(
      svg("image", {
        class: "count-image-mask",
        href: symbolOption.imageUrl,
        x: point.x - imageSize / 2,
        y: point.y - imageSize / 2,
        width: imageSize,
        height: imageSize,
        preserveAspectRatio: "xMidYMid meet",
      }),
    );
    defs.append(mask);
    nodes.push(
      defs,
      svg("rect", {
        class: "count-image",
        x: point.x - imageSize / 2,
        y: point.y - imageSize / 2,
        width: imageSize,
        height: imageSize,
        fill: measurement.color,
        mask: `url(#${maskId})`,
      }),
    );
    return nodes;
  }

  if (symbol === "duplex-receptacle") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("line", {
      class: "count-line",
      x1: point.x,
      y1: point.y - radius,
      x2: point.x,
      y2: point.y + radius,
      stroke: measurement.color,
      "stroke-width": scaled(1.7),
    }), svg("path", {
      class: "count-line",
      d: `M ${point.x - scaled(5.2)} ${point.y - scaled(2.8)} Q ${point.x - scaled(2.2)} ${point.y - scaled(5.4)} ${point.x} ${point.y - scaled(5.4)}`,
      stroke: measurement.color,
      "stroke-width": scaled(1.35),
      fill: "none",
    }), svg("path", {
      class: "count-line",
      d: `M ${point.x + scaled(5.2)} ${point.y + scaled(2.8)} Q ${point.x + scaled(2.2)} ${point.y + scaled(5.4)} ${point.x} ${point.y + scaled(5.4)}`,
      stroke: measurement.color,
      "stroke-width": scaled(1.35),
      fill: "none",
    }));
  }

  if (symbol === "weatherproof-duplex") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("line", {
      class: "count-line",
      x1: point.x,
      y1: point.y - radius,
      x2: point.x,
      y2: point.y + radius,
      stroke: measurement.color,
      "stroke-width": scaled(1.7),
    }), svg("line", {
      class: "count-line",
      x1: point.x - radius * 0.7,
      y1: point.y - radius * 0.7,
      x2: point.x + radius * 0.7,
      y2: point.y + radius * 0.7,
      stroke: measurement.color,
      "stroke-width": scaled(1.5),
    }));
  }

  if (symbol === "gfci-duplex") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": labelSize,
    }, "GFI"));
  }

  if (symbol === "switch") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": labelSize,
    }, "S"));
  }

  if (symbol === "three-way-switch") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": scaled(6.5),
    }, "S3"));
  }

  if (symbol === "junction-box") {
    nodes.push(
      svg("circle", {
        class: "count-marker",
        cx: point.x,
        cy: point.y,
        r: radius,
        stroke: measurement.color,
        "stroke-width": strokeWidth,
      }),
      svg("line", {
        class: "count-line",
        x1: point.x - radius * 0.65,
        y1: point.y - radius * 0.65,
        x2: point.x + radius * 0.65,
        y2: point.y + radius * 0.65,
        stroke: measurement.color,
        "stroke-width": strokeWidth,
      }),
      svg("line", {
        class: "count-line",
        x1: point.x + radius * 0.65,
        y1: point.y - radius * 0.65,
        x2: point.x - radius * 0.65,
        y2: point.y + radius * 0.65,
        stroke: measurement.color,
        "stroke-width": strokeWidth,
      }),
    );
  }

  if (symbol === "light-2x2") {
    nodes.push(svg("rect", {
      class: "count-marker",
      x: point.x - radius * 0.85,
      y: point.y - radius * 0.85,
      width: radius * 1.7,
      height: radius * 1.7,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": scaled(5.8),
    }, "2x2"));
  }

  if (symbol === "light-2x4") {
    nodes.push(svg("rect", {
      class: "count-marker",
      x: point.x - radius * 1.2,
      y: point.y - radius * 0.58,
      width: radius * 2.4,
      height: radius * 1.16,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": scaled(5.6),
    }, "2x4"));
  }

  if (symbol === "linear-light") {
    nodes.push(svg("rect", {
      class: "count-marker",
      x: point.x - radius * 1.35,
      y: point.y - radius * 0.34,
      width: radius * 2.7,
      height: radius * 0.68,
      rx: radius * 0.34,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }));
  }

  if (symbol === "can-light") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("circle", {
      class: "count-dot",
      cx: point.x,
      cy: point.y,
      r: innerRadius,
      fill: measurement.color,
    }));
  }

  if (symbol === "data-jack") {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": labelSize,
    }, "D"));
  }

  if (symbol === "security-camera") {
    nodes.push(svg("path", {
      class: "count-marker",
      d: `M ${point.x - radius * 0.95} ${point.y + radius * 0.22} L ${point.x + radius * 0.1} ${point.y - radius * 0.55} L ${point.x + radius * 0.95} ${point.y - radius * 0.16} L ${point.x - radius * 0.05} ${point.y + radius * 0.62} Z`,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("line", {
      class: "count-line",
      x1: point.x + radius * 0.28,
      y1: point.y + radius * 0.18,
      x2: point.x + radius * 0.95,
      y2: point.y + radius * 0.95,
      stroke: measurement.color,
      "stroke-width": scaled(1.8),
    }));
  }

  if (!nodes.length) {
    nodes.push(svg("circle", {
      class: "count-marker",
      cx: point.x,
      cy: point.y,
      r: radius,
      stroke: measurement.color,
      "stroke-width": strokeWidth,
    }), svg("text", {
      class: "count-symbol-text",
      x: point.x,
      y: point.y,
      "font-size": scaled(5.8),
    }, countSymbolAbbreviation(symbol)));
  }

  return nodes;
}

function renderPoints(group, points, color) {
  points.forEach((point) => {
    group.append(
      svg("circle", {
        class: "measurement-point",
        cx: point.x,
        cy: point.y,
        r: scaled(4.5),
        stroke: color,
        "stroke-width": "2",
      }),
    );
  });
}

function renderDraft() {
  const group = svg("g", { style: `color: ${COLORS[state.tool] || COLORS.length}` });
  const color = COLORS[state.tool] || COLORS.length;
  const draftPoints = draftRenderPoints();

  if (state.tool === "area" && draftPoints.length >= 3) {
    group.append(
      svg("polygon", {
        class: "draft-polygon",
        points: pointsAttribute(draftPoints),
      }),
    );
  } else if (draftPoints.length >= 2) {
    group.append(
      svg("polyline", {
        class: "draft-line",
        points: pointsAttribute(draftPoints),
      }),
    );
  }

  state.draft.forEach((point) => {
    group.append(
      svg("circle", {
        class: "measurement-point",
        cx: point.x,
        cy: point.y,
        r: scaled(4.5),
        stroke: color,
        "stroke-width": "2",
      }),
    );
  });

  if (state.previewPoint) {
    group.append(
      svg("circle", {
        class: "measurement-point draft-preview-point",
        cx: state.previewPoint.x,
        cy: state.previewPoint.y,
        r: scaled(4.5),
        stroke: color,
        "stroke-width": "2",
      }),
    );
  }

  return group;
}

function draftRenderPoints() {
  return state.previewPoint ? [...state.draft, state.previewPoint] : state.draft;
}

function renderMarkupsList() {
  els.markupsList.innerHTML = "";
  if (!state.markups.length) {
    els.markupsList.innerHTML = `<p class="muted">No markups yet.</p>`;
    return;
  }

  state.markups
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt))
    .forEach((markup) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `measure-row ${markup.id === state.selectedId && state.selectedType === "markup" ? "active" : ""}`;
      button.innerHTML = `
        <span class="measure-swatch" style="background: ${markup.color}"></span>
        <span>
          <strong>${escapeHtml(markupLabel(markup))}</strong>
          <span>${markupTypeLabel(markup.type)} on sheet ${markup.pageNumber}</span>
        </span>
        <span class="measure-value">${markup.type === "text" ? "Text" : `${markup.points.length} pts`}</span>
      `;
      button.addEventListener("click", () => {
        state.selectedId = markup.id;
        state.selectedType = "markup";
        state.selectedPointIndex = null;
        if (state.pageNumber !== markup.pageNumber) {
          state.pageNumber = markup.pageNumber;
          renderPage().then(renderAll).catch(handleRenderError);
        }
        renderAll();
      });
      els.markupsList.append(button);
    });
}

function renderMeasurementsList() {
  els.measurementsList.innerHTML = "";
  if (!state.measurements.length) {
    els.measurementsList.innerHTML = `<p class="muted">No measurements yet.</p>`;
    return;
  }

  state.measurements
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt))
    .forEach((measurement) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `measure-row ${measurement.id === state.selectedId && state.selectedType === "measurement" ? "active" : ""}`;
      button.innerHTML = `
        <span class="measure-swatch" style="background: ${measurement.color}"></span>
        <span>
          <strong>${escapeHtml(measurement.label)}</strong>
          <span>${capitalize(measurement.type)} on sheet ${measurement.pageNumber}</span>
        </span>
        <span class="measure-value">${escapeHtml(formatMeasurementValue(measurement))}</span>
      `;
      button.addEventListener("click", () => {
        state.selectedId = measurement.id;
        state.selectedType = "measurement";
        state.selectedPointIndex = null;
        if (state.pageNumber !== measurement.pageNumber) {
          state.pageNumber = measurement.pageNumber;
          renderPage().then(renderAll).catch(handleRenderError);
        }
        renderAll();
      });
      els.measurementsList.append(button);
    });
}

function renderSelection() {
  const measurement = selectedMeasurement();
  const markup = selectedMarkup();
  if (!measurement && !markup) {
    els.selectionPanel.className = "selection-panel muted";
    els.selectionPanel.textContent = "Nothing selected";
    return;
  }

  els.selectionPanel.className = "selection-panel";
  if (markup) {
    els.selectionPanel.innerHTML = `
      <div class="selection-title">
        <strong>${escapeHtml(markupLabel(markup))}</strong>
        <span>Sheet ${markup.pageNumber}</span>
      </div>
      <div class="selection-grid">
        <span>Type: ${markupTypeLabel(markup.type)}</span>
        <span>Color: ${escapeHtml(markup.color)}</span>
        <span>Points: ${markup.points.length}</span>
      </div>
    `;
    return;
  }

  if (measurement.type === "count") {
    const itemLabel = state.selectedPointIndex !== null ? `Item ${state.selectedPointIndex + 1}` : "Entire set";
    els.selectionPanel.innerHTML = `
      <div class="selection-title">
        <strong>${escapeHtml(measurement.label)}</strong>
        <span>Sheet ${measurement.pageNumber}</span>
      </div>
      <div class="selection-grid">
        <span>Type: Count</span>
        <span>Selected: ${itemLabel}</span>
        <span>Symbol: ${escapeHtml(countSymbolLabel(measurement.symbol))}</span>
        <span>Color: ${escapeHtml(measurement.color)}</span>
        <span>Total items: ${measurement.points.length}</span>
      </div>
      ${renderMeasurementRenameForm(measurement)}
    `;
    return;
  }

  els.selectionPanel.innerHTML = `
    <div class="selection-title">
      <strong>${escapeHtml(measurement.label)}</strong>
      <span>Sheet ${measurement.pageNumber}</span>
    </div>
    <div class="selection-grid">
      <span>Type: ${capitalize(measurement.type)}</span>
      <span>Value: ${escapeHtml(formatMeasurementValue(measurement))}</span>
      <span>Points: ${measurement.points.length}</span>
    </div>
    ${renderMeasurementRenameForm(measurement)}
  `;
}

function renderMeasurementRenameForm(measurement) {
  return `
    <form id="renameMeasurementForm" class="selection-form">
      <label>
        <span class="field-label">Name</span>
        <div class="selection-form-row">
          <input
            id="renameMeasurementInput"
            class="text-input"
            type="text"
            value="${escapeHtml(measurement.label)}"
            autocomplete="off"
          />
          <button class="button compact" type="submit">Rename</button>
        </div>
      </label>
    </form>
  `;
}

function renderTotals() {
  els.totalsList.innerHTML = "";
  if (!state.measurements.length) {
    els.totalsList.innerHTML = `<p class="muted">Totals appear as takeoff items are added.</p>`;
    return;
  }

  const totals = new Map();
  state.measurements.forEach((measurement) => {
    const key = `${measurement.type}:${measurement.label}`;
    if (!totals.has(key)) {
      totals.set(key, {
        type: measurement.type,
        label: measurement.label,
        value: 0,
      });
    }
    totals.get(key).value += rawMeasurementValue(measurement);
  });

  [...totals.values()].forEach((total) => {
    const row = document.createElement("div");
    row.className = "total-row";
    row.innerHTML = `
      <strong>${escapeHtml(total.label)}</strong>
      <span>${escapeHtml(formatRawValue(total.type, total.value))}</span>
    `;
    els.totalsList.append(row);
  });
}

function exportCsv() {
  if (!state.measurements.length) return;
  const rows = [
    ["Label", "Type", "Sheet", "Value", "Unit", "Point Count"],
    ...state.measurements.map((measurement) => [
      measurement.label,
      measurement.type,
      measurement.pageNumber,
      exportMeasurementValue(measurement),
      valueUnit(measurement.type),
      measurement.points.length,
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${fileStem(state.pdfName) || "takeoff"}-measurements.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileStem(filename) {
  return String(filename || "")
    .replace(/\.[^.]+$/i, "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .trim();
}

function canFinishDraft() {
  return (state.tool === "area" && state.draft.length >= 3) || (state.tool === "length" && state.draft.length >= 2);
}

function draftSummary() {
  if (!state.draft.length) return "";
  if (state.tool === "scale") return `${state.draft.length} / 2 scale points`;
  if (state.tool === "area") return `${state.draft.length} area points`;
  if (state.tool === "length") return `${state.draft.length} line points`;
  return "";
}

function selectedMeasurement() {
  if (state.selectedType !== "measurement") return null;
  return state.measurements.find((item) => item.id === state.selectedId);
}

function currentScale() {
  return scaleForPage(state.pageNumber);
}

function scaleForPage(pageNumber) {
  return state.scales[String(pageNumber)] || null;
}

function normalizeScalesPayload(source) {
  if (!source) return {};
  if (!Array.isArray(source) && typeof source === "object" && !("pdfUnitsPerUnit" in source)) {
    return Object.fromEntries(
      Object.entries(source)
        .filter(([, scale]) => scale && typeof scale === "object")
        .map(([pageNumber, scale]) => [String(pageNumber), scale]),
    );
  }
  if (typeof source === "object" && "pdfUnitsPerUnit" in source) {
    const pageNumber = String(source.pageNumber || 1);
    return { [pageNumber]: source };
  }
  return {};
}

function normalizeMeasurement(measurement) {
  if (measurement.type !== "count") return measurement;
  const symbol = normalizeCountSymbol(measurement.symbol);
  return {
    ...measurement,
    label: measurement.label || defaultCountLabel(symbol),
    symbol,
    color: measurement.color || COLORS.count,
  };
}

function selectedMarkup() {
  if (state.selectedType !== "markup") return null;
  return state.markups.find((item) => item.id === state.selectedId);
}

function markupLabel(markup) {
  return markup.type === "text" ? markup.text || "Text note" : markupTypeLabel(markup.type);
}

function markupTypeLabel(type) {
  const labels = {
    pen: "Pen",
    highlight: "Highlight",
    text: "Text note",
  };
  return labels[type] || capitalize(type);
}

function nextLabel(prefix) {
  const count = state.measurements.filter((item) => item.type === prefix.toLowerCase()).length + 1;
  return `${prefix} ${count}`;
}

function syncCountControls() {
  const measurement = selectedMeasurement();
  if (measurement?.type === "count") {
    state.countSymbol = normalizeCountSymbol(measurement.symbol);
    state.countColor = measurement.color || COLORS.count;
  } else {
    state.countSymbol = normalizeCountSymbol(state.countSymbol);
    state.countColor = state.countColor || COLORS.count;
  }

  els.countColor.value = state.countColor;
  renderCountSymbolPicker();
}

function renderCountSymbolPicker() {
  const activeSymbol = normalizeCountSymbol(state.countSymbol);
  const activeOption = countSymbolOption(activeSymbol);
  els.countSymbolButton.innerHTML = `
    <span class="symbol-picker-preview">${countSymbolPreviewHtml(activeOption, state.countColor)}</span>
    <span class="symbol-picker-copy">
      <strong>${escapeHtml(activeOption.label)}</strong>
      <span>Archtoolbox electrical symbols</span>
    </span>
    <span class="symbol-picker-caret" aria-hidden="true">▾</span>
  `;
  els.countSymbolButton.setAttribute("aria-expanded", String(state.countSymbolMenuOpen));
  els.countSymbolMenu.hidden = !state.countSymbolMenuOpen;
  els.countSymbolMenu.innerHTML = "";

  COUNT_SYMBOL_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `symbol-option ${option.value === activeSymbol ? "active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === activeSymbol));
    button.innerHTML = `
      <span class="symbol-option-preview">${countSymbolPreviewHtml(option, state.countColor)}</span>
      <span class="symbol-option-copy">
        <strong>${escapeHtml(option.label)}</strong>
      </span>
    `;
    button.addEventListener("click", () => selectCountSymbol(option.value));
    els.countSymbolMenu.append(button);
  });
}

function toggleCountSymbolMenu(force) {
  state.countSymbolMenuOpen = typeof force === "boolean" ? force : !state.countSymbolMenuOpen;
  renderCountSymbolPicker();
}

function closeCountSymbolMenu() {
  if (!state.countSymbolMenuOpen) return;
  state.countSymbolMenuOpen = false;
  renderCountSymbolPicker();
}

function selectCountSymbol(symbol) {
  const nextSymbol = normalizeCountSymbol(symbol);
  const previousSymbol = state.countSymbol;
  state.countSymbol = nextSymbol;
  const measurement = selectedMeasurement();
  if (measurement?.type === "count") {
    const previousDefault = defaultCountLabel(previousSymbol);
    measurement.symbol = state.countSymbol;
    if (!measurement.label || measurement.label === previousDefault) {
      measurement.label = defaultCountLabel(nextSymbol);
    }
  }
  state.countSymbolMenuOpen = false;
  renderAll();
}

function countSymbolOption(symbol) {
  return COUNT_SYMBOL_OPTIONS.find((option) => option.value === symbol) || COUNT_SYMBOL_OPTIONS[0];
}

function countSymbolLabel(symbol) {
  return countSymbolOption(normalizeCountSymbol(symbol)).label;
}

function countSymbolPreviewHtml(option, color) {
  if (option?.imageUrl) {
    return `<img class="symbol-preview-image" src="${escapeHtml(option.imageUrl)}" alt="${escapeHtml(option.label)}" loading="lazy" decoding="async" />`;
  }
  return countSymbolPreviewSvg(option?.value || COUNT_SYMBOL_OPTIONS[0].value, color);
}

function defaultCountLabel(symbol) {
  return countSymbolLabel(symbol);
}

function normalizeCountSymbol(symbol) {
  const legacyMap = {
    circle: "duplex-receptacle",
    square: "light-2x2",
    triangle: "switch",
    diamond: "junction-box",
    cross: "can-light",
    hexagon: "data-jack",
    star: "security-camera",
  };
  const normalized = legacyMap[symbol] || symbol;
  return COUNT_SYMBOL_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : COUNT_SYMBOL_OPTIONS[0].value;
}

function countSymbolPreviewSvg(symbol, color) {
  return `
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      ${countSymbolPreviewMarkup(normalizeCountSymbol(symbol), color || COLORS.count)}
    </svg>
  `;
}

function countSymbolPreviewMarkup(symbol, color) {
  const stroke = escapeHtml(color);
  const common = `fill="white" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
  const textCommon = `fill="${stroke}" font-family="Arial, sans-serif" font-size="7.5" font-weight="700" text-anchor="middle" dominant-baseline="central"`;

  const markup = {
    "duplex-receptacle": `<circle cx="16" cy="16" r="10" ${common}></circle><line x1="16" y1="6" x2="16" y2="26" stroke="${stroke}" stroke-width="1.7"></line><path d="M10 13.2c1.9-2 4.1-3 6-3" fill="none" stroke="${stroke}" stroke-width="1.4"></path><path d="M22 18.8c-1.9 2-4.1 3-6 3" fill="none" stroke="${stroke}" stroke-width="1.4"></path>`,
    "weatherproof-duplex": `<circle cx="16" cy="16" r="10" ${common}></circle><line x1="16" y1="6" x2="16" y2="26" stroke="${stroke}" stroke-width="1.7"></line><path d="M9 9l14 14" fill="none" stroke="${stroke}" stroke-width="1.5"></path>`,
    "gfci-duplex": `<circle cx="16" cy="16" r="10" ${common}></circle><text x="16" y="16.4" ${textCommon}>GFI</text>`,
    switch: `<circle cx="16" cy="16" r="10" ${common}></circle><text x="16" y="16.4" ${textCommon}>S</text>`,
    "three-way-switch": `<circle cx="16" cy="16" r="10" ${common}></circle><text x="16" y="16.4" ${textCommon}>S3</text>`,
    "junction-box": `<circle cx="16" cy="16" r="10" ${common}></circle><line x1="10" y1="10" x2="22" y2="22" stroke="${stroke}" stroke-width="1.8"></line><line x1="22" y1="10" x2="10" y2="22" stroke="${stroke}" stroke-width="1.8"></line>`,
    "light-2x2": `<rect x="8.5" y="8.5" width="15" height="15" ${common}></rect><text x="16" y="16.4" ${textCommon}>2x2</text>`,
    "light-2x4": `<rect x="6" y="11" width="20" height="10" ${common}></rect><text x="16" y="16.4" ${textCommon}>2x4</text>`,
    "linear-light": `<rect x="5.5" y="13" width="21" height="6" rx="3" ${common}></rect>`,
    "can-light": `<circle cx="16" cy="16" r="10" ${common}></circle><circle cx="16" cy="16" r="3.5" fill="${stroke}"></circle>`,
    "data-jack": `<circle cx="16" cy="16" r="10" ${common}></circle><text x="16" y="16.4" ${textCommon}>D</text>`,
    "security-camera": `<path d="M6.5 18.5l10-7 8 2.5-10 7z" ${common}></path><line x1="19" y1="17.8" x2="24.5" y2="23.5" stroke="${stroke}" stroke-width="1.8"></line>`,
  };
  if (markup[symbol]) return markup[symbol];
  return `<circle cx="16" cy="16" r="10" ${common}></circle><text x="16" y="16.4" ${textCommon}>${escapeHtml(countSymbolAbbreviation(symbol))}</text>`;
}

function countSymbolAbbreviation(symbol) {
  const words = countSymbolLabel(symbol)
    .replace(/\([^)]*\)/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "?";

  const shortWords = words.filter((word) => !["mounted", "receptacle", "symbol", "combination", "powered", "branch"].includes(word.toLowerCase()));
  const pool = shortWords.length ? shortWords : words;
  const abbreviation = pool.slice(0, 3).map((word) => {
    if (/^\d/.test(word)) return word.slice(0, 2);
    return word[0];
  }).join("");

  return abbreviation.slice(0, 4).toUpperCase();
}

function requestMarkupText() {
  const text = window.prompt("Markup text", "Note");
  return text?.trim() || "";
}

function rawMeasurementValue(measurement) {
  if (measurement.type === "count") return measurement.points.length;
  if (measurement.type === "area") return scaledArea(polygonArea(measurement.points), measurement.pageNumber);
  return scaledLength(polylineLength(measurement.points), measurement.pageNumber);
}

function numericMeasurementValue(measurement) {
  return Number(rawMeasurementValue(measurement).toFixed(measurement.type === "count" ? 0 : 3));
}

function exportMeasurementValue(measurement) {
  const value = rawMeasurementValue(measurement);
  const measurementScale = scaleForPage(measurement.pageNumber);
  if (measurement.type === "length" && measurementScale?.unit === "ft-in") {
    return formatImperialLength(value);
  }
  return Number(value.toFixed(measurement.type === "count" ? 0 : 3));
}

function formatMeasurementValue(measurement) {
  return formatRawValue(measurement.type, rawMeasurementValue(measurement));
}

function formatRawValue(type, value, pageNumber = state.pageNumber) {
  const measurementScale = scaleForPage(pageNumber);
  if (type === "count") return String(value);
  if (type === "length" && measurementScale?.unit === "ft-in") return formatImperialLength(value);
  if (type === "area") return `${formatNumber(value)} ${valueUnit(type, pageNumber)}`;
  return `${formatNumber(value)} ${valueUnit(type, pageNumber)}`;
}

function valueUnit(type, pageNumber = state.pageNumber) {
  const measurementScale = scaleForPage(pageNumber);
  if (!measurementScale && type !== "count") return type === "area" ? "sq page units" : "page units";
  if (type === "count") return "ea";
  if (measurementScale.unit === "ft-in") return type === "area" ? "sq ft" : "ft + in";
  if (type === "area") return `sq ${measurementScale.unit}`;
  return measurementScale.unit;
}

function scaledLength(pageUnits, pageNumber = state.pageNumber) {
  const measurementScale = scaleForPage(pageNumber);
  return measurementScale ? pageUnits / measurementScale.pdfUnitsPerUnit : pageUnits;
}

function scaledArea(pageSquareUnits, pageNumber = state.pageNumber) {
  const measurementScale = scaleForPage(pageNumber);
  return measurementScale ? pageSquareUnits / measurementScale.pdfUnitsPerUnit ** 2 : pageSquareUnits;
}

function parseScaleLength(value, unit) {
  if (unit === "ft-in") return parseImperialLengthToFeet(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function capturePageMetrics(page, viewport) {
  const [x1, y1, x2, y2] = page.view;
  const userUnit = page.userUnit || 1;
  const baseWidthPoints = Math.abs(x2 - x1) * userUnit;
  const baseHeightPoints = Math.abs(y2 - y1) * userUnit;
  const rotation = ((page.rotate || 0) % 360 + 360) % 360;
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const widthPoints = isQuarterTurn ? baseHeightPoints : baseWidthPoints;
  const heightPoints = isQuarterTurn ? baseWidthPoints : baseHeightPoints;
  const widthInches = widthPoints / 72;
  const heightInches = heightPoints / 72;

  return {
    widthInches,
    heightInches,
    overlayWidth: viewport.width,
    overlayHeight: viewport.height,
    unitsPerInchX: widthInches ? viewport.width / widthInches : 0,
    unitsPerInchY: heightInches ? viewport.height / heightInches : 0,
  };
}

function currentPageMetrics() {
  return state.pageMetrics[state.pageNumber] || null;
}

function currentPageUnitsPerInch() {
  const metrics = currentPageMetrics();
  if (!metrics) return 96;
  const values = [metrics.unitsPerInchX, metrics.unitsPerInchY].filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 96;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMeasuredSheetLength(pageUnits) {
  const pageUnitsPerInch = currentPageUnitsPerInch();
  if (!Number.isFinite(pageUnitsPerInch) || pageUnitsPerInch <= 0) return `~${formatNumber(pageUnits)} units`;
  return `${formatFractionalInches(pageUnits / pageUnitsPerInch)}"`;
}

function parseSheetLengthToInches(value, unit) {
  const parsed = parseFractionalNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return unit === "mm" ? parsed / 25.4 : parsed;
}

function parseFractionalNumber(value) {
  const source = String(value).trim();
  if (!source) return NaN;
  const parts = source.split(/\s+/).filter(Boolean);
  return parts.reduce((sum, part) => {
    if (!Number.isFinite(sum)) return NaN;
    if (/^\d+\/\d+$/.test(part)) {
      const [numerator, denominator] = part.split("/").map(Number);
      return denominator ? sum + numerator / denominator : NaN;
    }
    const parsed = Number(part);
    return Number.isFinite(parsed) ? sum + parsed : NaN;
  }, 0);
}

function parseImperialLengthToFeet(value) {
  const source = String(value).trim().toLowerCase().replaceAll(",", "");
  if (!source) return NaN;
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return Number(source);

  const isNegative = source.startsWith("-");
  const text = source.replace(/^-/, "").replaceAll("-", " ");
  let feet = 0;
  let inches = 0;
  let parsed = false;

  const feetMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)/);
  if (feetMatch) {
    feet = Number(feetMatch[1]);
    parsed = true;
  }

  const remaining = feetMatch
    ? `${text.slice(0, feetMatch.index)} ${text.slice(feetMatch.index + feetMatch[0].length)}`
    : text;
  const inchMatch = remaining.match(/(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|in\.?|inch(?:es)?)/);

  if (inchMatch) {
    inches = parseInchesComponent(inchMatch[1]);
    parsed = true;
  } else {
    const compact = remaining.trim();
    if (compact) {
      const parts = compact.split(/\s+/);
      if (feetMatch) {
        inches = parseInchesComponent(compact);
        parsed = Number.isFinite(inches);
      } else if (parts.length >= 2 && Number.isFinite(Number(parts[0]))) {
        feet = Number(parts[0]);
        inches = parseInchesComponent(parts.slice(1).join(" "));
        parsed = Number.isFinite(inches);
      }
    }
  }

  if (!parsed || !Number.isFinite(feet) || !Number.isFinite(inches)) return NaN;
  const length = feet + inches / 12;
  return isNegative ? -length : length;
}

function parseInchesComponent(value) {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return NaN;

  return parts.reduce((sum, part) => {
    if (!Number.isFinite(sum)) return NaN;
    if (/^\d+\/\d+$/.test(part)) {
      const [numerator, denominator] = part.split("/").map(Number);
      return denominator ? sum + numerator / denominator : NaN;
    }

    const parsed = Number(part);
    return Number.isFinite(parsed) ? sum + parsed : NaN;
  }, 0);
}

function polylineLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(points) {
  if (points.length === 2) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
  }
  const half = polylineLength(points) / 2;
  let traveled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = distance(start, end);
    if (traveled + segment >= half) {
      const ratio = (half - traveled) / segment;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }
    traveled += segment;
  }
  return points[0];
}

function polygonCentroid(points) {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function pointsAttribute(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function scaled(value) {
  return value / state.zoom;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function formatScaleInput(value, unit) {
  return unit === "ft-in" ? formatImperialLength(value) : String(value);
}

function formatSheetLengthInput(value, unit) {
  if (!Number.isFinite(value)) return "";
  if (unit === "mm") return formatNumber(value * 25.4);
  return formatFractionalInches(value);
}

function formatScaleLength(value, unit) {
  return unit === "ft-in" ? formatImperialLength(value) : `${formatNumber(value)} ${unit}`;
}

function scaleStatusText(pageNumber = state.pageNumber) {
  const activeScale = scaleForPage(pageNumber);
  if (!activeScale) return `Set scale for sheet ${pageNumber} from two known points on the plan.`;
  if (activeScale.source === "manual" && activeScale.sheetLengthInches) {
    const sheetUnit = activeScale.sheetUnit || "in";
    const sheetLength = formatSheetLength(activeScale.sheetLengthInches, sheetUnit);
    return `${sheetLength} on sheet ${pageNumber} = ${formatScaleLength(activeScale.realLength, activeScale.unit)}.`;
  }
  return `1 ${scaleBaseUnitLabel(activeScale.unit)} = ${activeScale.pdfUnitsPerUnit.toFixed(2)} page units on sheet ${pageNumber}.`;
}

function formatSheetLength(value, unit) {
  return unit === "mm" ? `${formatNumber(value * 25.4)} mm` : `${formatFractionalInches(value)}"`;
}

function scaleBaseUnitLabel(unit) {
  return unit === "ft-in" ? "ft" : unit;
}

function formatImperialLength(feet) {
  if (!Number.isFinite(feet)) return "0\"";

  const sign = feet < 0 ? "-" : "";
  const totalSixteenths = Math.round(Math.abs(feet) * 12 * 16);
  const wholeFeet = Math.floor(totalSixteenths / 192);
  const remainder = totalSixteenths % 192;
  const wholeInches = Math.floor(remainder / 16);
  const fractionalSixteenths = remainder % 16;
  let inchText = `${wholeInches}"`;

  if (fractionalSixteenths) {
    const divisor = greatestCommonDivisor(fractionalSixteenths, 16);
    const numerator = fractionalSixteenths / divisor;
    const denominator = 16 / divisor;
    inchText = wholeInches
      ? `${wholeInches} ${numerator}/${denominator}"`
      : `${numerator}/${denominator}"`;
  }

  return wholeFeet ? `${sign}${wholeFeet}' ${inchText}` : `${sign}${inchText}`;
}

function formatFractionalInches(inches) {
  if (!Number.isFinite(inches)) return "0";
  const sign = inches < 0 ? "-" : "";
  const totalSixteenths = Math.round(Math.abs(inches) * 16);
  const wholeInches = Math.floor(totalSixteenths / 16);
  const fractionalSixteenths = totalSixteenths % 16;
  if (!fractionalSixteenths) return `${sign}${wholeInches}`;

  const divisor = greatestCommonDivisor(fractionalSixteenths, 16);
  const numerator = fractionalSixteenths / divisor;
  const denominator = 16 / divisor;
  return wholeInches
    ? `${sign}${wholeInches} ${numerator}/${denominator}`
    : `${sign}${numerator}/${denominator}`;
}

function greatestCommonDivisor(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

function syncScaleLengthInput() {
  els.scaleLength.placeholder = els.scaleUnit.value === "ft-in" ? "10' 6 1/2\"" : "10";
  els.manualScaleLength.placeholder = els.manualScaleUnit.value === "ft-in" ? "1' 0\"" : "1";
  els.sheetLength.placeholder = els.sheetUnit.value === "mm" ? "6" : "1/4";
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function cancelActiveRender() {
  if (!state.renderTask) return;
  try {
    state.renderTask.cancel();
  } catch (error) {
    console.warn("Unable to cancel active render", error);
  }
  state.renderTask = null;
}

function handleRenderError(error) {
  if (error?.name === "RenderingCancelledException") return;
  console.error(error);
  setStatus("Unable to render this sheet.");
}

function getPdfJs() {
  return pdfjsLib;
}

function arrayBufferToBase64(buffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `takeoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function svg(tag, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined) element.setAttribute(key, value);
  });
  if (text) element.textContent = text;
  return element;
}
