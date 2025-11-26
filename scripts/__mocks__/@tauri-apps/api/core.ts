// Mock for @tauri-apps/api/core in test environment
export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  if (typeof (global as any).__TAURI_MOCK_INVOKE__ === "function") {
    return (global as any).__TAURI_MOCK_INVOKE__(cmd, args);
  }
  throw new Error("Tauri mock not initialized");
}

export function listen<T = any>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  // Mock event listener
  return Promise.resolve(() => {});
}

