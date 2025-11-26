import { useState, useEffect, useRef, useCallback } from "react";
import { captureScreen, listenToScreenChanges, getCaptureInterval, setCaptureInterval } from "../services/screenCapture";
import type { CaptureResult } from "../types";

export function useScreenCapture(enabled: boolean = true) {
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [screenshotHistory, setScreenshotHistory] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureInterval, setCaptureIntervalState] = useState(3);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastHashRef = useRef<string>("");

  // Load capture interval from backend
  useEffect(() => {
    getCaptureInterval().then(setCaptureIntervalState);
  }, []);

  // Listen to screen changes from backend
  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    listenToScreenChanges((result: CaptureResult) => {
      if (!mounted) return;
      
      if (result.hash !== lastHashRef.current) {
        lastHashRef.current = result.hash;
        setCurrentScreenshot(result.image_base64);
        setScreenshotHistory((prev) => {
          const updated = [...prev, result.image_base64];
          return updated.slice(-10); // Keep last 10 screenshots
        });
      }
    }).then((unsubscribe) => {
      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      mounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [enabled]);

  // Manual capture function
  const capture = useCallback(async () => {
    setIsCapturing(true);
    try {
      const result = await captureScreen();
      if (result.hash !== lastHashRef.current) {
        lastHashRef.current = result.hash;
        setCurrentScreenshot(result.image_base64);
        setScreenshotHistory((prev) => {
          const updated = [...prev, result.image_base64];
          return updated.slice(-10);
        });
      }
    } catch (error) {
      console.error("Screen capture error:", error);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // Update capture interval
  const updateInterval = useCallback(async (interval: number) => {
    await setCaptureInterval(interval);
    setCaptureIntervalState(interval);
  }, []);

  return {
    currentScreenshot,
    screenshotHistory,
    isCapturing,
    captureInterval,
    capture,
    updateInterval,
  };
}

