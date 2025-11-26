use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEvent {
    pub event_type: String, // "launched", "terminated", "focus_changed"
    pub process_name: String,
    pub timestamp: i64,
}

pub struct ProcessMonitor {
    sender: Option<mpsc::Sender<ProcessEvent>>,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self { sender: None }
    }

    pub fn start_monitoring<F>(&mut self, callback: F) -> Result<(), String>
    where
        F: Fn(ProcessEvent) + Send + 'static,
    {
        let (tx, _rx) = mpsc::channel();
        self.sender = Some(tx);

        thread::spawn(move || {
            let mut last_active = String::new();
            loop {
                match Self::get_active_process() {
                    Ok(current) => {
                        if current != last_active {
                            if !last_active.is_empty() {
                                callback(ProcessEvent {
                                    event_type: "focus_changed".to_string(),
                                    process_name: current.clone(),
                                    timestamp: chrono::Utc::now().timestamp(),
                                });
                            }
                            last_active = current;
                        }
                    }
                    Err(_) => {}
                }
                thread::sleep(Duration::from_millis(500));
            }
        });

        Ok(())
    }

    fn get_active_process() -> Result<String, String> {
        let output = Command::new("powershell")
            .arg("-Command")
            .arg("(Get-Process -Id (Get-ForegroundWindow).ProcessId).ProcessName")
            .output()
            .map_err(|e| format!("Failed to get active process: {}", e))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

