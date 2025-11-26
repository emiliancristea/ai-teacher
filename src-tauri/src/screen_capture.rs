use std::sync::atomic::AtomicU64;
use std::sync::Arc;

#[derive(Clone)]
pub struct ScreenCaptureState {
    pub interval_seconds: Arc<AtomicU64>,
}

impl Default for ScreenCaptureState {
    fn default() -> Self {
        Self {
            interval_seconds: Arc::new(AtomicU64::new(3)),
        }
    }
}

pub struct ScreenCapture;

impl ScreenCapture {
    pub fn new() -> Self {
        Self
    }

    pub async fn capture_full_screen(
        &self,
        _state: &ScreenCaptureState,
    ) -> Result<crate::commands::CaptureResult, String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        use sha2::{Sha256, Digest};
        use hex;
        use std::process::Command;

        #[cfg(target_os = "windows")]
        {
            // Use PowerShell to capture screenshot
            let ps_script = r#"
                Add-Type -AssemblyName System.Drawing
                $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
                $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bmp)
                $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
                $graphics.Dispose()
                
                $ms = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $bytes = $ms.ToArray()
                $ms.Dispose()
                $bmp.Dispose()
                
                [Convert]::ToBase64String($bytes)
            "#;

            let output = Command::new("powershell")
                .arg("-Command")
                .arg(ps_script)
                .output()
                .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("PowerShell error: {}", error));
            }

            let image_base64 = String::from_utf8(output.stdout)
                .map_err(|e| format!("Failed to parse PowerShell output: {}", e))?
                .trim()
                .to_string();

            // Decode base64 to bytes for processing
            use base64::{engine::general_purpose, Engine as _};
            let image_bytes = general_purpose::STANDARD
                .decode(&image_base64)
                .map_err(|e| format!("Failed to decode base64: {}", e))?;

            // Store original length before potential move
            let original_len = image_bytes.len();

            // Calculate hash
            let mut hasher = Sha256::new();
            hasher.update(&image_bytes);
            let hash = hex::encode(hasher.finalize());

            // Compress if too large (max 2MB)
            let final_bytes = if image_bytes.len() > 2_000_000 {
                // Load and resize image
                let img = image::load_from_memory(&image_bytes)
                    .map_err(|e| format!("Failed to load image: {}", e))?;
                let resized = img.resize(
                    (img.width() as f32 * 0.7) as u32,
                    (img.height() as f32 * 0.7) as u32,
                    image::imageops::FilterType::Lanczos3,
                );
                // Save to PNG bytes
                let mut compressed = Vec::new();
                {
                    use image::ImageEncoder;
                    let encoder = image::codecs::png::PngEncoder::new(&mut compressed);
                    encoder
                        .write_image(
                            &resized.to_rgba8(),
                            resized.width(),
                            resized.height(),
                            image::ColorType::Rgba8.into(),
                        )
                        .map_err(|e| format!("Failed to encode compressed PNG: {}", e))?;
                }
                compressed
            } else {
                image_bytes
            };

            // Re-encode to base64 if we compressed
            let final_base64 = if final_bytes.len() != original_len {
                general_purpose::STANDARD.encode(&final_bytes)
            } else {
                image_base64
            };

            // Get timestamp
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            Ok(crate::commands::CaptureResult {
                image_base64: final_base64,
                hash,
                timestamp,
            })
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Fallback for non-Windows platforms
            Err("Screen capture not implemented for this platform".to_string())
        }
    }
}

