# Fixed OCR script for Windows - uses C# helper for better COM interop
# Usage: .\scripts\test-ocr-fixed.ps1 "path\to\image.png"

param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'

try {
    # Convert to absolute path (required by Windows.Storage.StorageFile)
    $absoluteImagePath = (Resolve-Path $ImagePath -ErrorAction Stop).Path
    
    if (-not (Test-Path $absoluteImagePath)) {
        throw "Image file not found: $absoluteImagePath"
    }
    
    [Console]::Error.WriteLine('[OCR] Loading Windows Runtime assemblies...')
    
    # Load System.Runtime.WindowsRuntime to get extension methods
    $runtimeDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $runtimeDll = Join-Path $runtimeDir 'System.Runtime.WindowsRuntime.dll'
    
    if (-not (Test-Path $runtimeDll)) {
        throw "System.Runtime.WindowsRuntime.dll not found at: $runtimeDll"
    }
    
    $runtimeAssembly = [System.Reflection.Assembly]::LoadFrom($runtimeDll)
    if ($null -eq $runtimeAssembly) {
        throw "Failed to load System.Runtime.WindowsRuntime.dll"
    }
    
    # Get System.WindowsRuntimeSystemExtensions
    $extensionType = $runtimeAssembly.GetType('System.WindowsRuntimeSystemExtensions')
    if ($null -eq $extensionType) {
        throw "Failed to find System.WindowsRuntimeSystemExtensions type"
    }
    
    # Find the generic AsTask<T> method
    $asTaskMethods = $extensionType.GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and 
        $_.GetParameters().Count -eq 1 -and
        $_.IsGenericMethodDefinition
    }
    if ($null -eq $asTaskMethods -or $asTaskMethods.Count -eq 0) {
        throw "Failed to find generic AsTask method"
    }
    $asTaskMethod = $asTaskMethods | Select-Object -First 1
    
    # Try to compile C# helper class for better COM interop
    $useCSharpHelper = $false
    try {
        Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices.WindowsRuntime;
            using System.Threading.Tasks;
            using Windows.Foundation;
            
            public static class AsyncHelper {
                public static T GetResult<T>(object asyncOperation) {
                    var asyncOp = (IAsyncOperation<T>)asyncOperation;
                    return asyncOp.AsTask().Result;
                }
            }
"@ -ErrorAction Stop
        $useCSharpHelper = $true
        [Console]::Error.WriteLine('[OCR] C# helper class compiled successfully')
    } catch {
        [Console]::Error.WriteLine('[OCR] C# helper compilation failed, using reflection method: ' + $_.Exception.Message)
    }
    
    # Load Windows Runtime types
    [Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    
    [Console]::Error.WriteLine('[OCR] Loading image from: ' + $absoluteImagePath)
    
    # Helper function using reflection to call AsTask on COM objects
    function Invoke-AsTask {
        param($asyncOp, [Type]$resultType)
        
        if ($null -eq $asyncOp) {
            throw "Async operation is null"
        }
        
        if ($useCSharpHelper) {
            # Use C# helper class
            $helperMethod = [AsyncHelper].GetMethod('GetResult').MakeGenericMethod($resultType)
            return $helperMethod.Invoke($null, @($asyncOp))
        }
        
        # Use AsTask method via reflection
        $genericMethod = $asTaskMethod.MakeGenericMethod($resultType)
        $task = $genericMethod.Invoke($null, @($asyncOp))
        
        if ($null -eq $task) {
            throw "AsTask returned null Task"
        }
        
        return $task.Result
    }
    
    [Console]::Error.WriteLine('[OCR] Step 1: Getting file from path...')
    $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absoluteImagePath)
    $file = Invoke-AsTask $fileTask ([Windows.Storage.StorageFile])
    [Console]::Error.WriteLine('[OCR] File loaded successfully')
    
    [Console]::Error.WriteLine('[OCR] Step 2: Opening file stream...')
    $streamTask = $file.OpenReadAsync()
    # Try IRandomAccessStream first, fallback to IRandomAccessStreamWithContentType
    try {
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
    } catch {
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    }
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
    if ($null -eq $ocrEngine) {
        [Console]::Error.WriteLine('[OCR] Trying alternative language method...')
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::CurrentInputMethodLanguageTag)
    }
    
    if ($null -eq $ocrEngine) {
        [Console]::Error.WriteLine('[OCR] ERROR: Could not create OCR engine - language pack may be missing')
        Write-Output ""
        exit 0
    }
    
    [Console]::Error.WriteLine('[OCR] Step 6: Recognizing text...')
    $ocrResultTask = $ocrEngine.RecognizeAsync($bitmap)
    $ocrResult = Invoke-AsTask $ocrResultTask ([Windows.Media.Ocr.OcrResult])
    $lineCount = $ocrResult.Lines.Count
    [Console]::Error.WriteLine("[OCR] Found $lineCount text lines")
    
    # Debug: Check OCR result structure
    if ($null -eq $ocrResult) {
        [Console]::Error.WriteLine('[OCR] WARNING: OCR result is null')
        $text = ""
    } elseif ($lineCount -eq 0) {
        [Console]::Error.WriteLine('[OCR] WARNING: No text lines found in image')
        $text = ""
    } else {
        # Extract text from all lines and words
        $words = @()
        foreach ($line in $ocrResult.Lines) {
            if ($null -ne $line -and $null -ne $line.Words) {
                foreach ($word in $line.Words) {
                    if ($null -ne $word -and $null -ne $word.Text -and $word.Text.Trim() -ne "") {
                        $words += $word.Text
                    }
                }
            }
        }
        $text = $words -join " "
        [Console]::Error.WriteLine('[OCR] Extracted ' + $text.Length + ' characters from ' + $words.Count + ' words')
        
        # Debug: Show first few words if any found
        if ($words.Count -gt 0) {
            $preview = ($words | Select-Object -First 5) -join " "
            [Console]::Error.WriteLine('[OCR] Preview: ' + $preview)
        }
    }
    
    $stream.Dispose()
    # Don't delete the image file - keep it for debugging
    # Remove-Item $absoluteImagePath -ErrorAction SilentlyContinue
    
    # Output text to stdout (not stderr)
    Write-Output $text
    
} catch {
    [Console]::Error.WriteLine('[OCR] ERROR: ' + $_.Exception.GetType().FullName)
    [Console]::Error.WriteLine('[OCR] ERROR Message: ' + $_.Exception.Message)
    [Console]::Error.WriteLine('[OCR] Stack trace: ' + $_.ScriptStackTrace)
    if ($_.Exception.InnerException) {
        [Console]::Error.WriteLine('[OCR] Inner Exception: ' + $_.Exception.InnerException.Message)
    }
    Write-Output ""
    exit 1
}

