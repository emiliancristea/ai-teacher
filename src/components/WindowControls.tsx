import { invoke } from "@tauri-apps/api/core";

export function WindowControls() {
  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleMaximize = async () => {
    try {
      await invoke("maximize_window");
    } catch (error) {
      console.error("Failed to maximize window:", error);
    }
  };

  const handleClose = async () => {
    try {
      await invoke("close_window");
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  return (
    <div className="window-controls">
      <button
        className="window-control minimize"
        onClick={handleMinimize}
        title="Minimize"
        aria-label="Minimize window"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      <button
        className="window-control maximize"
        onClick={handleMaximize}
        title="Maximize / Restore"
        aria-label="Maximize window"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 2H10V10H2V2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button
        className="window-control close"
        onClick={handleClose}
        title="Close"
        aria-label="Close window"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

