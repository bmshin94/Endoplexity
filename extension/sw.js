// The panel does the real work: it owns the WebSocket and (from Phase 1) drives
// chrome.debugger directly. Side panel pages have full extension API access and
// stay alive while open, which dodges the MV3 service-worker idle teardown.
// So this worker exists only to make the toolbar button open the panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("setPanelBehavior failed", err));
