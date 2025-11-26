use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use std::fs;
use std::path::PathBuf;
use base64::{engine::general_purpose, Engine as _};

use crate::screen_capture::{ScreenCapture, ScreenCaptureState};

/// Helper function to extract JSON from PowerShell output which may contain extra text
fn extract_json_from_output(output: &str) -> String {
    // Try to find JSON object/array in the output
    // PowerShell might output warnings or errors before/after JSON
    
    // IMPORTANT: Check for arrays FIRST, because arrays contain objects
    // If we check for objects first, we'll only get the first object in an array
    if let Some(start) = output.find('[') {
        let mut bracket_count = 0;
        let mut end = start;
        for (i, ch) in output[start..].char_indices() {
            match ch {
                '[' => bracket_count += 1,
                ']' => {
                    bracket_count -= 1;
                    if bracket_count == 0 {
                        end = start + i;
                        return output[start..=end].trim().to_string();
                    }
                }
                _ => {}
            }
        }
        // Fallback: if we didn't find matching brackets, use rfind
        if let Some(end_pos) = output.rfind(']') {
            return output[start..=end_pos].trim().to_string();
        }
    }
    
    // Then, try to find a valid JSON object by matching braces
    if let Some(start) = output.find('{') {
        let mut brace_count = 0;
        let mut end = start;
        for (i, ch) in output[start..].char_indices() {
            match ch {
                '{' => brace_count += 1,
                '}' => {
                    brace_count -= 1;
                    if brace_count == 0 {
                        end = start + i;
                        return output[start..=end].trim().to_string();
                    }
                }
                _ => {}
            }
        }
        // Fallback: if we didn't find matching braces, use rfind
        if let Some(end_pos) = output.rfind('}') {
            return output[start..=end_pos].trim().to_string();
        }
    }
    
    // If no JSON found, return trimmed output (might be a simple string)
    output.trim().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureResult {
    pub image_base64: String,
    pub hash: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowCaptureResult {
    pub image_base64: String,
    pub hash: String,
    pub timestamp: i64,
    pub ocr_text: Option<String>,
    pub window_title: String,
    pub process_name: String,
}

#[tauri::command]
pub async fn capture_screen(
    state: State<'_, ScreenCaptureState>,
) -> Result<CaptureResult, String> {
    let capture = ScreenCapture::new();
    capture.capture_full_screen(state.inner()).await
}

#[tauri::command]
pub async fn get_active_window() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("powershell")
            .arg("-Command")
            .arg("(Get-Process -Id (Get-ForegroundWindow).ProcessId).ProcessName")
            .output()
            .map_err(|e| format!("Failed to get active window: {}", e))?;
        
        let process_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(process_name)
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok("unknown".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub title: String,
    pub process_name: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemContext {
    pub active_window: String,
    pub active_window_title: String,
    pub open_windows: Vec<WindowInfo>,
    pub running_applications: Vec<String>,
    pub timestamp: i64,
}

#[tauri::command]
pub async fn get_system_context() -> Result<SystemContext, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use chrono::Utc;
        
        // Get active window info
        let active_script = r#"
            Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                using System.Text;
                public class Win32 {
                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll")]
                    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                    [DllImport("user32.dll")]
                    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
                }
"@
            $hwnd = [Win32]::GetForegroundWindow()
            $processId = 0
            [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId)
            $process = Get-Process -Id $processId
            $sb = New-Object System.Text.StringBuilder 256
            [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            @{
                ProcessName = $process.ProcessName
                WindowTitle = $title
            } | ConvertTo-Json
        "#;

        let active_output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(active_script)
            .stderr(std::process::Stdio::null()) // Suppress stderr to avoid warnings
            .output()
            .map_err(|e| format!("Failed to get active window: {}", e))?;

        // Check if PowerShell command failed
        if !active_output.status.success() {
            let error_msg = String::from_utf8_lossy(&active_output.stderr);
            return Err(format!("PowerShell command failed: {}", error_msg));
        }

        let active_output_str = String::from_utf8_lossy(&active_output.stdout);
        // Extract JSON from output (PowerShell might add extra text)
        let active_json_str = extract_json_from_output(&active_output_str);
        
        // Try to parse JSON, with better error reporting
        let active_json: serde_json::Value = serde_json::from_str(&active_json_str)
            .map_err(|e| {
                format!(
                    "Failed to parse active window JSON: {}\nExtracted JSON: {}\nFull output: {}",
                    e, active_json_str, active_output_str
                )
            })?;

        let active_process = active_json["ProcessName"].as_str().unwrap_or("unknown").to_string();
        let active_title = active_json["WindowTitle"].as_str().unwrap_or("").to_string();

        // Get all open windows
        let windows_script = r#"
            Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                using System.Text;
                using System.Collections.Generic;
                public class Win32 {
                    [DllImport("user32.dll")]
                    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll")]
                    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                    [DllImport("user32.dll")]
                    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
                    [DllImport("user32.dll")]
                    public static extern bool IsWindowVisible(IntPtr hWnd);
                    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                }
"@
            $windows = New-Object System.Collections.ArrayList
            $foreground = [Win32]::GetForegroundWindow()
            
            [Win32]::EnumWindows({
                param($hWnd, $lParam)
                if ([Win32]::IsWindowVisible($hWnd)) {
                    $processId = 0
                    [Win32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
                    try {
                        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                        if ($process) {
                            $sb = New-Object System.Text.StringBuilder 256
                            [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                            $title = $sb.ToString()
                            if ($title.Length -gt 0) {
                                $windows.Add(@{
                                    Title = $title
                                    ProcessName = $process.ProcessName
                                    IsActive = ($hWnd -eq $foreground)
                                }) | Out-Null
                            }
                        }
                    } catch {}
                }
                return $true
            }, [IntPtr]::Zero) | Out-Null
            
            $windows | ConvertTo-Json -Depth 3
        "#;

        let windows_output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(windows_script)
            .stderr(std::process::Stdio::null()) // Suppress stderr to avoid warnings
            .output()
            .map_err(|e| format!("Failed to get windows: {}", e))?;

        // Check if PowerShell command failed
        if !windows_output.status.success() {
            let error_msg = String::from_utf8_lossy(&windows_output.stderr);
            return Err(format!("PowerShell windows command failed: {}", error_msg));
        }

        let windows_output_str = String::from_utf8_lossy(&windows_output.stdout);
        // Extract JSON from output
        let windows_json_str = extract_json_from_output(&windows_output_str);
        let windows_json: Vec<serde_json::Value> = serde_json::from_str(&windows_json_str)
            .unwrap_or_default();

        let open_windows: Vec<WindowInfo> = windows_json
            .into_iter()
            .filter_map(|w| {
                Some(WindowInfo {
                    title: w["Title"].as_str()?.to_string(),
                    process_name: w["ProcessName"].as_str()?.to_string(),
                    is_active: w["IsActive"].as_bool().unwrap_or(false),
                })
            })
            .collect();

        // Get running applications (unique process names)
        let apps_script = r#"
            Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | 
            Select-Object -ExpandProperty ProcessName -Unique | 
            ConvertTo-Json
        "#;

        let apps_output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(apps_script)
            .stderr(std::process::Stdio::null()) // Suppress stderr to avoid warnings
            .output()
            .map_err(|e| format!("Failed to get applications: {}", e))?;

        // Check if PowerShell command failed
        if !apps_output.status.success() {
            let error_msg = String::from_utf8_lossy(&apps_output.stderr);
            return Err(format!("PowerShell applications command failed: {}", error_msg));
        }

        let apps_output_str = String::from_utf8_lossy(&apps_output.stdout);
        // Extract JSON from output
        let apps_json_str = extract_json_from_output(&apps_output_str);
        let apps_json: Vec<String> = serde_json::from_str(&apps_json_str)
            .unwrap_or_default();

        Ok(SystemContext {
            active_window: active_process.clone(),
            active_window_title: active_title,
            open_windows,
            running_applications: apps_json,
            timestamp: Utc::now().timestamp(),
        })
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        use chrono::Utc;
        Ok(SystemContext {
            active_window: "unknown".to_string(),
            active_window_title: "unknown".to_string(),
            open_windows: vec![],
            running_applications: vec![],
            timestamp: Utc::now().timestamp(),
        })
    }
}

/// Extract text from an image using Windows OCR
#[tauri::command]
pub async fn extract_text_from_image(image_base64: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use base64::{engine::general_purpose, Engine as _};
        
        // Decode base64 image
        let image_bytes = general_purpose::STANDARD
            .decode(&image_base64)
            .map_err(|e| format!("Failed to decode base64 image: {}", e))?;
        
        // Save to temp file for OCR
        let temp_path = std::env::temp_dir().join(format!("ocr_temp_{}.png", 
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()));
        
        std::fs::write(&temp_path, &image_bytes)
            .map_err(|e| format!("Failed to write temp image: {}", e))?;
        
        // Use Windows OCR via PowerShell - using working approach from test script
        // Convert path to absolute (required by Windows.Storage.StorageFile)
        let mut absolute_path = temp_path.canonicalize()
            .map_err(|e| format!("Failed to get absolute path: {}", e))?
            .to_string_lossy()
            .to_string();
        
        // Remove extended path prefix (\\?\) if present - it causes issues with PowerShell
        if absolute_path.starts_with("\\\\?\\") {
            absolute_path = absolute_path[4..].to_string();
        }
        
        // For PowerShell single-quoted strings, backslashes don't need escaping
        // But we'll use the path as-is since we're using single quotes in the script
        let escaped_path = absolute_path;
        
        let ocr_script = format!(r#"
            $ErrorActionPreference = 'Stop'
            try {{
                [Console]::Error.WriteLine('[OCR] Loading Windows Runtime assemblies...')
                
                # Load System.Runtime.WindowsRuntime to get extension methods
                $runtimeDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
                $runtimeDll = [System.IO.Path]::Combine($runtimeDir, 'System.Runtime.WindowsRuntime.dll')
                
                if (-not (Test-Path $runtimeDll)) {{
                    throw "System.Runtime.WindowsRuntime.dll not found at: $runtimeDll"
                }}
                
                $runtimeAssembly = [System.Reflection.Assembly]::LoadFrom($runtimeDll)
                if ($null -eq $runtimeAssembly) {{
                    throw "Failed to load System.Runtime.WindowsRuntime.dll"
                }}
                
                # Get System.WindowsRuntimeSystemExtensions
                $extensionType = $runtimeAssembly.GetType('System.WindowsRuntimeSystemExtensions')
                if ($null -eq $extensionType) {{
                    throw "Failed to find System.WindowsRuntimeSystemExtensions type"
                }}
                
                # Find the generic AsTask<T> method
                $asTaskMethods = $extensionType.GetMethods() | Where-Object {{ 
                    $_.Name -eq 'AsTask' -and 
                    $_.GetParameters().Count -eq 1 -and
                    $_.IsGenericMethodDefinition
                }}
                if ($null -eq $asTaskMethods -or $asTaskMethods.Count -eq 0) {{
                    throw "Failed to find generic AsTask method"
                }}
                $asTaskMethod = $asTaskMethods | Select-Object -First 1
                
                # Try to compile C# helper class for better COM interop
                $useCSharpHelper = $false
                try {{
                    Add-Type -TypeDefinition @"
                        using System;
                        using System.Runtime.InteropServices.WindowsRuntime;
                        using System.Threading.Tasks;
                        using Windows.Foundation;
                        
                        public static class AsyncHelper {{
                            public static T GetResult<T>(object asyncOperation) {{
                                var asyncOp = (IAsyncOperation<T>)asyncOperation;
                                return asyncOp.AsTask().Result;
                            }}
                        }}
"@ -ErrorAction Stop
                    $useCSharpHelper = $true
                    [Console]::Error.WriteLine('[OCR] C# helper class compiled successfully')
                }} catch {{
                    [Console]::Error.WriteLine('[OCR] C# helper compilation failed, using reflection method: ' + $_.Exception.Message)
                }}
                
                # Load Windows Runtime types
                [Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType=WindowsRuntime] | Out-Null
                [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
                [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
                
                $imagePath = '{}'
                [Console]::Error.WriteLine("[OCR] Loading image from: $imagePath")
                
                # Verify file exists before proceeding
                if (-not (Test-Path -LiteralPath $imagePath)) {{
                    throw "Image file not found: $imagePath"
                }}
                
                # Helper function using reflection or C# helper to call AsTask on COM objects
                function Invoke-AsTask {{
                    param($asyncOp, [Type]$resultType)
                    if ($null -eq $asyncOp) {{
                        throw "Async operation is null"
                    }}
                    
                    if ($useCSharpHelper) {{
                        # Use C# helper class for better COM interop
                        $helperMethod = [AsyncHelper].GetMethod('GetResult').MakeGenericMethod($resultType)
                        return $helperMethod.Invoke($null, @($asyncOp))
                    }}
                    
                    # Fallback to reflection method
                    $genericMethod = $asTaskMethod.MakeGenericMethod($resultType)
                    $task = $genericMethod.Invoke($null, @($asyncOp))
                    if ($null -eq $task) {{
                        throw "AsTask returned null Task"
                    }}
                    return $task.Result
                }}
                
                [Console]::Error.WriteLine('[OCR] Step 1: Getting file from path...')
                $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)
                $file = Invoke-AsTask $fileTask ([Windows.Storage.StorageFile])
                [Console]::Error.WriteLine('[OCR] File loaded successfully')
                
                [Console]::Error.WriteLine('[OCR] Step 2: Opening file stream...')
                $streamTask = $file.OpenReadAsync()
                # Try IRandomAccessStream first, fallback to IRandomAccessStreamWithContentType
                try {{
                    $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
                }} catch {{
                    $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                }}
                [Console]::Error.WriteLine('[OCR] Stream opened successfully')
                
                [Console]::Error.WriteLine('[OCR] Step 3: Creating bitmap decoder...')
                $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
                $decoder = Invoke-AsTask $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
                [Console]::Error.WriteLine('[OCR] Decoder created successfully')
                
                [Console]::Error.WriteLine('[OCR] Step 4: Getting software bitmap...')
                $bitmapTask = $decoder.GetSoftwareBitmapAsync()
                $bitmap = Invoke-AsTask $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
                [Console]::Error.WriteLine('[OCR] Image loaded: ' + $bitmap.PixelWidth + 'x' + $bitmap.PixelHeight)
                
                [Console]::Error.WriteLine('[OCR] Step 5: Creating OCR engine...')
                $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
                if ($ocrEngine -eq $null) {{
                    [Console]::Error.WriteLine('[OCR] Trying alternative language method...')
                    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::CurrentInputMethodLanguageTag)
                }}
                
                if ($ocrEngine -eq $null) {{
                    [Console]::Error.WriteLine('[OCR] ERROR: Could not create OCR engine - language pack may be missing')
                    Write-Output ""
                    exit 0
                }}
                
                [Console]::Error.WriteLine('[OCR] Step 6: Recognizing text...')
                $ocrResultTask = $ocrEngine.RecognizeAsync($bitmap)
                $ocrResult = Invoke-AsTask $ocrResultTask ([Windows.Media.Ocr.OcrResult])
                $lineCount = $ocrResult.Lines.Count
                [Console]::Error.WriteLine("[OCR] Found $($lineCount) text lines")
                
                # Extract text from all lines and words with proper null checking
                $words = @()
                if ($null -ne $ocrResult -and $lineCount -gt 0) {{
                    foreach ($line in $ocrResult.Lines) {{
                        if ($null -ne $line -and $null -ne $line.Words) {{
                            foreach ($word in $line.Words) {{
                                if ($null -ne $word -and $null -ne $word.Text -and $word.Text.Trim() -ne "") {{
                                    $words += $word.Text
                                }}
                            }}
                        }}
                    }}
                }}
                $text = $words -join " "
                [Console]::Error.WriteLine("[OCR] Extracted $($text.Length) characters from $($words.Count) words")
                
                # Debug: Write text length to stderr before outputting
                if ($text.Length -eq 0) {{
                    [Console]::Error.WriteLine("[OCR] WARNING: Text is empty after extraction")
                    [Console]::Error.WriteLine("[OCR] Line count: $lineCount")
                    [Console]::Error.WriteLine("[OCR] Word count: $($words.Count)")
                }} else {{
                    $preview = if ($text.Length -gt 100) {{ $text.Substring(0, 100) }} else {{ $text }}
                    [Console]::Error.WriteLine("[OCR] Text preview: $preview")
                }}
                
                $stream.Dispose()
                Remove-Item $imagePath -ErrorAction SilentlyContinue
                
                # Use Write-Output to ensure text goes to stdout
                Write-Output $text
                # Also write to stderr for debugging (will be filtered out)
                [Console]::Error.WriteLine("[OCR] Text written to stdout: $($text.Length) chars")
            }} catch {{
                [Console]::Error.WriteLine('[OCR] ERROR: ' + $_.Exception.GetType().FullName)
                [Console]::Error.WriteLine('[OCR] ERROR Message: ' + $_.Exception.Message)
                [Console]::Error.WriteLine('[OCR] Stack trace: ' + $_.ScriptStackTrace)
                if ($_.Exception.InnerException) {{
                    [Console]::Error.WriteLine('[OCR] Inner Exception: ' + $_.Exception.InnerException.Message)
                }}
                Write-Output ""
            }}
        "#, escaped_path);
        
        eprintln!("[extract_text_from_image] 🔍 Running OCR on image: {} bytes", image_bytes.len());
        eprintln!("[extract_text_from_image] 📁 Temp file: {:?}", temp_path);
        
        // Write script to temp file to avoid command-line length limits and permission issues
        let script_path = std::env::temp_dir().join(format!("ocr_script_{}.ps1", 
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()));
        
        let script_path_abs = script_path.canonicalize()
            .unwrap_or_else(|_| script_path.clone());
        
        std::fs::write(&script_path, &ocr_script)
            .map_err(|e| format!("Failed to write OCR script to temp file: {}", e))?;
        
        eprintln!("[extract_text_from_image] 📜 Script written to: {:?}", script_path_abs);
        eprintln!("[extract_text_from_image] 📜 Script size: {} bytes", ocr_script.len());
        
        // Execute PowerShell script with UTF-8 output encoding
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(format!(
                r#"$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '{}'"#,
                script_path_abs.to_string_lossy().replace('\'', "''")
            ))
            .stderr(std::process::Stdio::piped()) // Capture stderr to see errors
            .stdout(std::process::Stdio::piped()) // Capture stdout
            .output()
            .map_err(|e| format!("Failed to execute OCR PowerShell: {}", e))?;
        
        // Don't clean up script file immediately - keep for debugging
        // let _ = std::fs::remove_file(&script_path);
        
        // Log stderr for debugging - always show it
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        eprintln!("[extract_text_from_image] 📋 PowerShell exit code: {:?}", output.status.code());
        eprintln!("[extract_text_from_image] 📋 PowerShell stdout length: {} bytes", output.stdout.len());
        eprintln!("[extract_text_from_image] 📋 PowerShell stderr length: {} bytes", output.stderr.len());
        
        if !stderr_str.trim().is_empty() {
            eprintln!("[extract_text_from_image] ⚠️ PowerShell stderr output:");
            eprintln!("{}", stderr_str);
        } else {
            eprintln!("[extract_text_from_image] ℹ️ No stderr output from PowerShell");
        }
        
        // Clean up temp file
        let _ = std::fs::remove_file(&temp_path);
        
        if !output.status.success() {
            let error_msg = format!("OCR command failed with status: {:?}. Stderr: {}", 
                output.status.code(), 
                stderr_str
            );
            eprintln!("[extract_text_from_image] ❌ {}", error_msg);
            return Err(error_msg);
        }
        
        // Read stdout as UTF-8 (PowerShell with UTF-8 encoding should output UTF-8)
        let ocr_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        
        eprintln!("[extract_text_from_image] 📊 OCR stdout length: {} bytes", output.stdout.len());
        eprintln!("[extract_text_from_image] 📝 OCR text length: {} characters", ocr_text.len());
        
        // Debug: Show raw stdout bytes (first 200 bytes) if empty
        if ocr_text.is_empty() && output.stdout.len() > 0 {
            let preview_bytes: String = output.stdout.iter().take(200).enumerate().map(|(i, b)| {
                if i > 0 && i % 16 == 0 { format!("\n  {:04x}: {:02x} ", i, b) }
                else { format!("{:02x} ", b) }
            }).collect();
            eprintln!("[extract_text_from_image] 🔍 Raw stdout bytes:\n  {:04x}: {}", 0, preview_bytes);
        }
        
        if ocr_text.is_empty() {
            eprintln!("[extract_text_from_image] ⚠️ OCR returned empty text.");
            if !stderr_str.trim().is_empty() {
                eprintln!("[extract_text_from_image] Check stderr output above for errors.");
            } else {
                eprintln!("[extract_text_from_image] Possible reasons:");
                eprintln!("  - Image contains no readable text");
                eprintln!("  - OCR engine couldn't detect text");
                eprintln!("  - Language pack not installed");
                eprintln!("  - Image quality too low");
            }
        } else {
            let preview = if ocr_text.len() > 100 {
                format!("{}...", &ocr_text[..100])
            } else {
                ocr_text.clone()
            };
            eprintln!("[extract_text_from_image] ✅ OCR preview: {}", preview);
        }
        
        Ok(ocr_text)
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("OCR not implemented for this platform".to_string())
    }
}

#[derive(Debug, Deserialize)]
pub struct CaptureWindowParams {
    #[serde(default)]
    pub process_name: Option<String>,
    #[serde(default)]
    pub window_title: Option<String>,
}

/// List all windows matching a process name or window title
#[tauri::command]
pub async fn list_windows_by_process(
    options: CaptureWindowParams,
) -> Result<Vec<WindowInfo>, String> {
    let process_name = options.process_name;
    let window_title = options.window_title;
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // Build match condition
        let match_condition = if let Some(ref proc) = process_name {
            if let Some(ref title) = window_title {
                format!(
                    r#"$match = ($process.ProcessName -ieq '{}') -and ($title -ilike '*{}*')"#,
                    proc.replace("'", "''"), title.replace("'", "''")
                )
            } else {
                format!(
                    r#"$procName = $process.ProcessName
                    $searchName = '{}'
                    $procNameLower = $procName.ToLower()
                    $searchNameLower = $searchName.ToLower()
                    $match = ($procNameLower -eq $searchNameLower) -or ($procNameLower -eq ($searchNameLower + '.exe')) -or ($procNameLower -like ('*' + $searchNameLower + '*'))"#,
                    proc.replace("'", "''")
                )
            }
        } else if let Some(ref title) = window_title {
            format!(r#"$match = $title -ilike '*{}*'"#, title.replace("'", "''"))
        } else {
            "$match = $true".to_string()
        };
        
        // Build PowerShell script to list all matching windows
        let list_script = format!(r#"
            $ErrorActionPreference = 'Continue'
            Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                using System.Text;
                public class Win32 {{
                    [DllImport("user32.dll")]
                    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll")]
                    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                    [DllImport("user32.dll")]
                    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
                    [DllImport("user32.dll")]
                    public static extern bool IsWindowVisible(IntPtr hWnd);
                    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                }}
"@
            $windows = New-Object System.Collections.ArrayList
            $foreground = [Win32]::GetForegroundWindow()
            $enumCount = 0
            $checkedCount = 0
            
            [Win32]::EnumWindows({{
                param($hWnd, $lParam)
                $script:enumCount++
                if ([Win32]::IsWindowVisible($hWnd)) {{
                    $processId = 0
                    [Win32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
                    try {{
                        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                        if ($process) {{
                            $sb = New-Object System.Text.StringBuilder 256
                            [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                            $title = $sb.ToString()
                            
                            if ($title.Length -gt 0) {{
                                $script:checkedCount++
                                $match = $false
                                {}
                                
                                if ($match) {{
                                    [Console]::Error.WriteLine('[LIST] MATCH: Process=' + $process.ProcessName + ', Title=' + $title)
                                    $windows.Add(@{{
                                        Title = $title
                                        ProcessName = $process.ProcessName
                                        IsActive = ($hWnd -eq $foreground)
                                    }}) | Out-Null
                                }}
                            }}
                        }}
                    }} catch {{
                        # Silently continue on errors
                    }}
                }}
                return $true
            }}, [IntPtr]::Zero) | Out-Null
            
            [Console]::Error.WriteLine('[LIST] EnumWindows checked ' + $script:enumCount + ' windows, checked ' + $script:checkedCount + ' with titles, found ' + $windows.Count + ' matches')
            $windows | ConvertTo-Json -Depth 3
        "#, match_condition);
        
        eprintln!("[list_windows_by_process] Searching for process_name: {:?}, window_title: {:?}", process_name, window_title);
        
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&list_script)
            .stderr(std::process::Stdio::piped()) // Capture stderr for debugging
            .output()
            .map_err(|e| format!("Failed to list windows: {}", e))?;
        
        // Log stderr for debugging
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        if !stderr_str.trim().is_empty() {
            eprintln!("[list_windows_by_process] PowerShell stderr: {}", stderr_str);
        }
        
        if !output.status.success() {
            let error_msg = format!("PowerShell command failed. Stderr: {}", stderr_str);
            eprintln!("[list_windows_by_process] ❌ {}", error_msg);
            return Err(error_msg);
        }
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        eprintln!("[list_windows_by_process] PowerShell stdout length: {} bytes", output_str.len());
        eprintln!("[list_windows_by_process] PowerShell stdout preview: {}", 
            if output_str.len() > 200 { 
                format!("{}...", &output_str[..200]) 
            } else { 
                output_str.to_string() 
            }
        );
        
        let json_str = extract_json_from_output(&output_str);
        eprintln!("[list_windows_by_process] Extracted JSON: {}", 
            if json_str.len() > 200 { 
                format!("{}...", &json_str[..200]) 
            } else { 
                json_str.clone() 
            }
        );
        
        // Parse as Value first, then handle both array and single object cases
        let json_value: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| {
                eprintln!("[list_windows_by_process] JSON parse error: {}", e);
                eprintln!("[list_windows_by_process] JSON string: {}", json_str);
                format!("Failed to parse windows JSON: {}", e)
            })?;
        
        // PowerShell ConvertTo-Json returns a single object when there's 1 item, array when multiple
        let windows_json: Vec<serde_json::Value> = match json_value {
            serde_json::Value::Array(arr) => arr,
            serde_json::Value::Object(_) => vec![json_value], // Single object, wrap in array
            _ => {
                eprintln!("[list_windows_by_process] Unexpected JSON type: {:?}", json_value);
                vec![]
            }
        };
        
        eprintln!("[list_windows_by_process] Parsed {} window(s) from JSON", windows_json.len());
        
        let windows: Vec<WindowInfo> = windows_json
            .into_iter()
            .filter_map(|w| {
                let title = w["Title"].as_str()?.to_string();
                let process_name = w["ProcessName"].as_str()?.to_string();
                let is_active = w["IsActive"].as_bool().unwrap_or(false);
                eprintln!("[list_windows_by_process] Found window: \"{}\" (process: {}, active: {})", 
                    title, process_name, is_active);
                Some(WindowInfo {
                    title,
                    process_name,
                    is_active,
                })
            })
            .collect();
        
        eprintln!("[list_windows_by_process] ✅ Returning {} window(s)", windows.len());
        Ok(windows)
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

/// Capture a specific window by process name or window title
#[tauri::command]
pub async fn capture_window(
    options: CaptureWindowParams,
) -> Result<WindowCaptureResult, String> {
    let process_name = options.process_name;
    let window_title = options.window_title;
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::time::{SystemTime, UNIX_EPOCH};
        use sha2::{Sha256, Digest};
        use hex;
        use base64::{engine::general_purpose, Engine as _};
        
        // Debug: Log received parameters
        eprintln!("[capture_window] Received process_name: {:?}, window_title: {:?}", process_name, window_title);
        
        // Build match condition first - use case-insensitive matching
        let match_condition = if let Some(ref proc) = process_name {
            if let Some(ref title) = window_title {
                let cond = format!(
                    r#"$match = ($process.ProcessName -ieq '{}') -and ($title -ilike '*{}*')"#,
                    proc.replace("'", "''"), title.replace("'", "''")
                );
                eprintln!("[capture_window] Match condition (process + title): {}", cond);
                cond
            } else {
                // Case-insensitive process name matching
                // Try multiple variations: exact match, with .exe, and contains match
                // Also log ProcessName for debugging (write to stderr so it's captured)
                let cond = format!(
                    r#"$procName = $process.ProcessName
                    $searchName = '{}'
                    $procNameLower = $procName.ToLower()
                    $searchNameLower = $searchName.ToLower()
                    $debugMsg1 = '[DEBUG] Comparing: ProcessName=' + $procName + ' (lower: ' + $procNameLower + ') with searchName=' + $searchName + ' (lower: ' + $searchNameLower + ')'
                    [Console]::Error.WriteLine($debugMsg1)
                    $match = ($procNameLower -eq $searchNameLower) -or ($procNameLower -eq ($searchNameLower + '.exe')) -or ($procNameLower -like ('*' + $searchNameLower + '*'))
                    if ($match) {{
                        $debugMsg2 = '[DEBUG] MATCH FOUND: ProcessName=' + $procName + ' matches ' + $searchName
                        [Console]::Error.WriteLine($debugMsg2)
                    }} else {{
                        $debugMsg3 = '[DEBUG] NO MATCH: ProcessName=' + $procName + ' does not match ' + $searchName
                        [Console]::Error.WriteLine($debugMsg3)
                    }}"#,
                    proc.replace("'", "''")
                );
                eprintln!("[capture_window] Match condition (process only): {}", cond);
                cond
            }
        } else if let Some(ref title) = window_title {
            let cond = format!(r#"$match = $title -ilike '*{}*'"#, title.replace("'", "''"));
            eprintln!("[capture_window] Match condition (title only): {}", cond);
            cond
        } else {
            eprintln!("[capture_window] Match condition: $match = $true (no filters)");
            "$match = $true".to_string()
        };
        
        // Build PowerShell script to capture specific window
        let enum_windows_close = "}, [IntPtr]::Zero) | Out-Null";
        let capture_script = format!(r#"
            # Load System.Drawing assembly for PowerShell use
            Add-Type -AssemblyName System.Drawing
            
            # Compile C# code (System.Drawing is only used in PowerShell, not in C#)
            Add-Type @" 
                using System;
                using System.Runtime.InteropServices;
                using System.Text;
                public class Win32 {{
                    [DllImport("user32.dll")]
                    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                    [DllImport("user32.dll")]
                    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
                    [DllImport("user32.dll")]
                    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
                    [DllImport("user32.dll")]
                    public static extern bool IsWindowVisible(IntPtr hWnd);
                    [DllImport("user32.dll")]
                    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                    [DllImport("user32.dll")]
                    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
                    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                    [StructLayout(LayoutKind.Sequential)]
                    public struct RECT {{
                        public int Left;
                        public int Top;
                        public int Right;
                        public int Bottom;
                    }}
                }}
"@
            $script:targetHwnd = [IntPtr]::Zero
            $script:targetProcess = $null
            $script:targetTitle = $null
            $script:enumCount = 0
            $script:checkedProcesses = @()
            
            [Win32]::EnumWindows({{
                param($hWnd, $lParam)
                $script:enumCount++
                if ([Win32]::IsWindowVisible($hWnd)) {{
                    $processId = 0
                    [Win32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
                    try {{
                        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                        if ($process) {{
                            if ($script:checkedProcesses -notcontains $process.ProcessName) {{
                                $script:checkedProcesses += $process.ProcessName
                            }}
                            $sb = New-Object System.Text.StringBuilder 256
                            [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                            $title = $sb.ToString()
                            
                            $match = $false
                            {}
                            
                            # The match condition above sets $match, now use it
                            if ($match) {{
                                $script:targetHwnd = $hWnd
                                $script:targetProcess = $process
                                $script:targetTitle = $title
                                $debugMsg = \"[DEBUG] CAPTURING: hWnd=$hWnd, Process=\" + $process.ProcessName + \", Title=$title\"
                                [Console]::Error.WriteLine($debugMsg)
                                return $false
                            }}
                        }}
                    }} catch {{
                        # Silently continue on errors
                    }}
                }}
                return $true
            {}
            $processList = $script:checkedProcesses -join ', '
            $debugMsg = '[DEBUG] EnumWindows checked ' + $script:enumCount + ' windows, found processes: ' + $processList
            [Console]::Error.WriteLine($debugMsg)
            
            if ($script:targetHwnd -eq [IntPtr]::Zero) {{
                # Debug: List available processes for troubleshooting
                $availableProcesses = Get-Process | Where-Object {{ $_.MainWindowTitle -ne "" }} | Select-Object ProcessName -Unique | ForEach-Object {{ $_.ProcessName }}
                $errorMsg = "Window not found. Available processes with windows: " + ($availableProcesses -join ", ")
                Write-Error $errorMsg
                exit 1
            }}
            
            $rect = New-Object Win32+RECT
            [Win32]::GetWindowRect($script:targetHwnd, [ref]$rect)
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            
            # Note: We don't bring window to foreground as it can cause focus issues
            # PW_RENDERFULLCONTENT should work even when window is not in foreground
            
            $bmp = New-Object System.Drawing.Bitmap($width, $height)
            $graphics = [System.Drawing.Graphics]::FromImage($bmp)
            $hdc = $graphics.GetHdc()
            
            # Use PW_RENDERFULLCONTENT (0x2) flag to capture hardware-accelerated content
            # Flag 0 = PW_CLIENTONLY (old method, doesn't work with modern apps)
            # Flag 2 = PW_RENDERFULLCONTENT (captures composited window content)
            $captured = [Win32]::PrintWindow($script:targetHwnd, $hdc, 2)
            
            # If PW_RENDERFULLCONTENT fails, try with flag 0 as fallback
            if (-not $captured) {{
                [Win32]::PrintWindow($script:targetHwnd, $hdc, 0) | Out-Null
            }}
            
            $graphics.ReleaseHdc($hdc)
            $graphics.Dispose()
            
            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bytes = $ms.ToArray()
            $ms.Dispose()
            $bmp.Dispose()
            
            $base64 = [Convert]::ToBase64String($bytes)
            $json = @{{
                ImageBase64 = $base64
                WindowTitle = $script:targetTitle
                ProcessName = $script:targetProcess.ProcessName
            }} | ConvertTo-Json
            
            $json
        "#, match_condition, enum_windows_close);
        
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&capture_script)
            .stderr(std::process::Stdio::piped()) // Capture stderr to see debug output
            .output()
            .map_err(|e| format!("Failed to capture window: {}", e))?;
        
        // Log stderr for debugging
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        if !stderr_str.trim().is_empty() {
            eprintln!("[capture_window] PowerShell stderr: {}", stderr_str);
        }
        
        if !output.status.success() {
            // Get error message from stderr for better debugging
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "Window not found or capture failed. Process: {:?}, Title: {:?}. Error: {}. Output: {}",
                process_name, window_title, error_msg, stdout_msg
            ));
        }
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        let json_str = extract_json_from_output(&output_str);
        let json: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse capture result: {}", e))?;
        
        let image_base64 = json["ImageBase64"].as_str()
            .ok_or("Missing ImageBase64 in result")?.to_string();
        let window_title = json["WindowTitle"].as_str()
            .unwrap_or("").to_string();
        let process_name = json["ProcessName"].as_str()
            .unwrap_or("").to_string();
        
        // Decode image to calculate hash
        let image_bytes = general_purpose::STANDARD
            .decode(&image_base64)
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        
        let mut hasher = Sha256::new();
        hasher.update(&image_bytes);
        let hash = hex::encode(hasher.finalize());
        
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        
        Ok(WindowCaptureResult {
            image_base64,
            hash,
            timestamp,
            ocr_text: None,
            window_title,
            process_name,
        })
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("Window capture not implemented for this platform".to_string())
    }
}

/// Helper function to save captured image to disk for debugging
fn save_captured_image(base64_data: &str, window_title: &str, process_name: &str) -> Result<PathBuf, String> {
    // Decode base64 to bytes
    let image_bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    // Create captures directory in the project root or temp directory
    let captures_dir = if let Ok(exe_path) = std::env::current_exe() {
        // Try to use project directory (parent of target/debug or target/release)
        if let Some(exe_dir) = exe_path.parent() {
            if let Some(target_dir) = exe_dir.parent() {
                if let Some(project_dir) = target_dir.parent() {
                    project_dir.join("captures")
                } else {
                    std::env::temp_dir().join("ai-teacher-captures")
                }
            } else {
                std::env::temp_dir().join("ai-teacher-captures")
            }
        } else {
            std::env::temp_dir().join("ai-teacher-captures")
        }
    } else {
        std::env::temp_dir().join("ai-teacher-captures")
    };
    
    // Create directory if it doesn't exist
    fs::create_dir_all(&captures_dir)
        .map_err(|e| format!("Failed to create captures directory: {}", e))?;
    
    // Sanitize window title for filename
    let sanitized_title = window_title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect::<String>();
    let sanitized_process = process_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    
    // Create filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let filename = format!("{}_{}_{}.png", sanitized_process, sanitized_title, timestamp);
    let file_path = captures_dir.join(&filename);
    
    // Save image
    fs::write(&file_path, image_bytes)
        .map_err(|e| format!("Failed to write image file: {}", e))?;
    
    eprintln!("[save_captured_image] 💾 Saved captured image to: {}", file_path.display());
    
    Ok(file_path)
}

/// Capture a window and extract text using OCR
#[tauri::command]
pub async fn capture_window_with_ocr(
    options: CaptureWindowParams,
) -> Result<WindowCaptureResult, String> {
    eprintln!("[capture_window_with_ocr] 📸 Step 1: Capturing window...");
    // First capture the window
    let mut result = capture_window(options).await?;
    eprintln!("[capture_window_with_ocr] ✅ Window captured: {} ({} KB image)", 
        result.window_title, 
        result.image_base64.len() / 1024
    );
    
    // Save image to disk for debugging
    match save_captured_image(&result.image_base64, &result.window_title, &result.process_name) {
        Ok(path) => {
            eprintln!("[capture_window_with_ocr] 💾 Image saved to: {}", path.display());
        }
        Err(e) => {
            eprintln!("[capture_window_with_ocr] ⚠️ Failed to save image: {}", e);
            // Don't fail the capture if saving fails
        }
    }
    
    eprintln!("[capture_window_with_ocr] 🔍 Step 2: Running OCR on captured image...");
    // Then extract text using OCR
    match extract_text_from_image(result.image_base64.clone()).await {
        Ok(text) => {
            eprintln!("[capture_window_with_ocr] ✅ OCR completed: extracted {} characters", text.len());
            if !text.is_empty() {
                let preview = if text.len() > 100 {
                    format!("{}...", &text[..100])
                } else {
                    text.clone()
                };
                eprintln!("[capture_window_with_ocr] 📝 OCR preview: {}", preview);
            } else {
                eprintln!("[capture_window_with_ocr] ⚠️ OCR returned empty text");
            }
            result.ocr_text = Some(text);
            eprintln!("[capture_window_with_ocr] 📤 Step 3: Returning result with image and OCR text");
            Ok(result)
        }
        Err(e) => {
            // Return result even if OCR fails
            eprintln!("[capture_window_with_ocr] ❌ OCR failed: {}", e);
            eprintln!("[capture_window_with_ocr] 📤 Returning result without OCR text");
            Ok(result)
        }
    }
}

#[tauri::command]
pub async fn start_monitoring(
    app: AppHandle,
    state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    
    tokio::spawn(async move {
        let mut last_hash = String::new();
        
        loop {
            let interval_secs = state_clone.interval_seconds.load(std::sync::atomic::Ordering::Relaxed);
            tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
            
            let capture = ScreenCapture::new();
            match capture.capture_full_screen(&state_clone).await {
                Ok(result) => {
                    if result.hash != last_hash {
                        last_hash = result.hash.clone();
                        let _ = app_clone.emit("screen-changed", result);
                    }
                }
                Err(e) => {
                    eprintln!("Screen capture error: {}", e);
                }
            }
        }
    });
    
    Ok(())
}

#[tauri::command]
pub async fn stop_monitoring() -> Result<(), String> {
    // Monitoring is handled by the spawned task, this is a placeholder
    Ok(())
}

#[tauri::command]
pub async fn get_capture_interval(
    state: State<'_, ScreenCaptureState>,
) -> Result<u64, String> {
    Ok(state.interval_seconds.load(std::sync::atomic::Ordering::Relaxed))
}

#[tauri::command]
pub async fn set_capture_interval(
    state: State<'_, ScreenCaptureState>,
    interval: u64,
) -> Result<(), String> {
    if interval < 1 || interval > 10 {
        return Err("Interval must be between 1 and 10 seconds".to_string());
    }
    state.interval_seconds.store(interval, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn minimize_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn maximize_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

fn validate_docker_command(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Docker requires a subcommand.".to_string());
    }

    let subcommand = args[0].as_str();
    match subcommand {
        "ps" | "stats" | "info" | "version" | "events" | "top" => Ok(()),
        "logs" | "inspect" => Ok(()),
        "compose" => {
            if args.len() < 2 {
                return Err("Specify a docker compose subcommand.".to_string());
            }
            match args[1].as_str() {
                "ps" | "config" | "ls" | "top" | "logs" => Ok(()),
                other => Err(format!(
                    "Docker compose subcommand '{}' is not permitted. Run it manually if needed.",
                    other
                )),
            }
        }
        other => Err(format!(
            "Docker subcommand '{}' is not permitted. Run it manually if needed.",
            other
        )),
    }
}

fn validate_git_command(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("Git requires a subcommand.".to_string());
    }

    let subcommand = args[0].as_str();
    match subcommand {
        "status" | "log" | "show" | "diff" | "rev-parse" => Ok(()),
        "branch" => {
            if args.iter().any(|arg| arg == "-d" || arg == "--delete" || arg == "-D") {
                Err("Deleting branches via the agent is not permitted.".to_string())
            } else {
                Ok(())
            }
        }
        "config" => {
            if args.iter().skip(1).any(|arg| arg == "--list" || arg == "-l") {
                Ok(())
            } else {
                Err("Only 'git config --list' is permitted via the agent.".to_string())
            }
        }
        other => Err(format!(
            "Git subcommand '{}' is not permitted. Run it manually if needed.",
            other
        )),
    }
}

fn validate_npm_command(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("npm requires a subcommand.".to_string());
    }
    match args[0].as_str() {
        "ls" | "list" | "view" | "whoami" => Ok(()),
        "config" => {
            if args.len() >= 2 {
                let sub = args[1].as_str();
                if sub == "list" || sub == "get" || sub.starts_with("get") {
                    return Ok(());
                }
            }
            Err("Only 'npm config list' or 'npm config get ...' are permitted via the agent.".to_string())
        }
        other => Err(format!(
            "npm subcommand '{}' is not permitted. Run it manually if needed.",
            other
        )),
    }
}

fn validate_node_command(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("node requires arguments.".to_string());
    }
    match args[0].as_str() {
        "-v" | "--version" => Ok(()),
        other => Err(format!(
            "node argument '{}' is not permitted. Only version checks are allowed.",
            other
        )),
    }
}

fn validate_python_command(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("python requires arguments.".to_string());
    }
    match args[0].as_str() {
        "-v" | "--version" | "-version" => Ok(()),
        other => Err(format!(
            "python argument '{}' is not permitted. Only version checks are allowed.",
            other
        )),
    }
}

fn validate_powershell_command(args: &[String]) -> Result<(), String> {
    if args.len() >= 2 && (args[0] == "-command" || args[0] == "-c") {
        let command_text = args[1].as_str();
        if command_text.starts_with("get-process") {
            return Ok(());
        }
    }
    Err("Only 'Get-Process' is permitted via PowerShell for safety reasons.".to_string())
}

fn validate_cmd_command(args: &[String]) -> Result<(), String> {
    if args.len() >= 2 && args[0] == "/c" && args[1] == "tasklist" {
        return Ok(());
    }
    Err("Only 'cmd /c tasklist' is permitted via the agent.".to_string())
}

fn validate_command_policy(command: &str, args: &[String]) -> Result<(), String> {
    let lowered_args: Vec<String> = args.iter().map(|arg| arg.to_lowercase()).collect();
    match command {
        "docker" => validate_docker_command(&lowered_args),
        "git" => validate_git_command(&lowered_args),
        "npm" => validate_npm_command(&lowered_args),
        "node" => validate_node_command(&lowered_args),
        "python" => validate_python_command(&lowered_args),
        "powershell" | "pwsh" => validate_powershell_command(&lowered_args),
        "cmd" => validate_cmd_command(&lowered_args),
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn execute_command(command: String, args: Vec<String>) -> Result<CommandResult, String> {
    use std::process::Command;
    
    // Security: Only allow safe commands
    // For now, allow common commands like docker, git, etc.
    // In production, you might want to whitelist specific commands
    let allowed_commands = ["docker", "git", "npm", "node", "python", "pwsh", "powershell", "cmd"];
    let command_lower = command.to_lowercase();
    
    if !allowed_commands.iter().any(|&cmd| command_lower.starts_with(cmd)) {
        let allowed_list = allowed_commands.iter().map(|s| *s).collect::<Vec<_>>().join(", ");
        return Ok(CommandResult {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            error: Some(format!("Command '{}' is not allowed. Allowed commands: {}", command, allowed_list)),
        });
    }
    if let Err(reason) = validate_command_policy(&command_lower, &args) {
        println!(
            "[Security] Blocked command '{} {:?}' - {}",
            command, args, reason
        );
        return Ok(CommandResult {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            error: Some(reason),
        });
    }

    // Execute the command
    let output = if cfg!(target_os = "windows") {
        // On Windows, use cmd.exe /c or PowerShell
        if command_lower == "docker" || command_lower == "git" {
            // These commands are usually in PATH
            Command::new(&command)
                .args(&args)
                .output()
                .map_err(|e| format!("Failed to execute command: {}", e))?
        } else {
            // For other commands, try PowerShell
            let mut cmd = Command::new("powershell");
            cmd.arg("-Command");
            let full_cmd = format!("{} {}", command, args.join(" "));
            cmd.arg(&full_cmd);
            cmd.output()
                .map_err(|e| format!("Failed to execute command: {}", e))?
        }
    } else {
        // On Unix-like systems
        Command::new(&command)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?
    };
    
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();
    let success = output.status.success();
    
    Ok(CommandResult {
        success,
        stdout,
        stderr,
        exit_code,
        error: if success { None } else { Some(format!("Command failed with exit code: {:?}", exit_code)) },
    })
}

