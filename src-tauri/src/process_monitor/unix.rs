// Placeholder for non-Windows platforms
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEvent {
    pub event_type: String,
    pub process_name: String,
    pub timestamp: i64,
}

pub struct ProcessMonitor {
    // Placeholder implementation
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self
    }

    pub fn start_monitoring<F>(&mut self, _callback: F) -> Result<(), String>
    where
        F: Fn(ProcessEvent) + Send + 'static,
    {
        // Not implemented for non-Windows platforms
        Ok(())
    }
}

