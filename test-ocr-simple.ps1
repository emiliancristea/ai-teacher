# Simple OCR test script - minimal version to debug issues
# Usage: .\test-ocr-simple.ps1 "path\to\image.png"

param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'

try {
    Write-Host "=== OCR Test Script ===" -ForegroundColor Cyan
    Write-Host "Image path: $ImagePath" -ForegroundColor Yellow
    
    # Convert to absolute path
    $absoluteImagePath = (Resolve-Path $ImagePath -ErrorAction Stop).Path
    Write-Host "Absolute path: $absoluteImagePath" -ForegroundColor Yellow
    
    if (-not (Test-Path $absoluteImagePath)) {
        throw "Image file not found: $absoluteImagePath"
    }
    
    Write-Host ""
    Write-Host "[1/6] Loading Windows Runtime assemblies..." -ForegroundColor Cyan
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    
    # Load System.Runtime.WindowsRuntime
    $runtimeDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $runtimeDll = Join-Path $runtimeDir 'System.Runtime.WindowsRuntime.dll'
    Write-Host "Runtime DLL: $runtimeDll" -ForegroundColor Gray
    
    if (-not (Test-Path $runtimeDll)) {
        throw "System.Runtime.WindowsRuntime.dll not found at: $runtimeDll"
    }
    
    $runtimeAssembly = [System.Reflection.Assembly]::LoadFrom($runtimeDll)
    Write-Host "OK Runtime assembly loaded" -ForegroundColor Green
    
    # Get System.WindowsRuntimeSystemExtensions
    $extensionType = $runtimeAssembly.GetType('System.WindowsRuntimeSystemExtensions')
    if ($null -eq $extensionType) {
        throw "Failed to find System.WindowsRuntimeSystemExtensions"
    }
    Write-Host "OK Found System.WindowsRuntimeSystemExtensions" -ForegroundColor Green
    
    # Find generic AsTask method
    $asTaskMethods = $extensionType.GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and 
        $_.GetParameters().Count -eq 1 -and
        $_.IsGenericMethodDefinition
    }
    
    if ($null -eq $asTaskMethods -or $asTaskMethods.Count -eq 0) {
        throw "Failed to find generic AsTask method"
    }
    $asTaskMethod = $asTaskMethods | Select-Object -First 1
    Write-Host "OK Found AsTask method" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "[2/6] Loading Windows Runtime types..." -ForegroundColor Cyan
    [Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    Write-Host "OK Windows Runtime types loaded" -ForegroundColor Green
    
    # Helper function
    function Invoke-AsTask {
        param($asyncOp, [Type]$resultType)
        if ($null -eq $asyncOp) {
            throw "Async operation is null"
        }
        $genericMethod = $asTaskMethod.MakeGenericMethod($resultType)
        $task = $genericMethod.Invoke($null, @($asyncOp))
        if ($null -eq $task) {
            throw "AsTask returned null Task"
        }
        return $task.Result
    }
    
    Write-Host ""
    Write-Host "[3/6] Loading image file..." -ForegroundColor Cyan
    $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absoluteImagePath)
    $file = Invoke-AsTask $fileTask ([Windows.Storage.StorageFile])
    if ($null -eq $file) {
        throw "File is null after loading"
    }
    Write-Host "OK File loaded: $($file.Name)" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "[4/6] Opening file stream..." -ForegroundColor Cyan
    $streamTask = $file.OpenReadAsync()
    try {
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
    } catch {
        Write-Host "Trying IRandomAccessStreamWithContentType..." -ForegroundColor Yellow
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    }
    Write-Host "OK Stream opened" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "[5/6] Creating decoder and bitmap..." -ForegroundColor Cyan
    $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoder = Invoke-AsTask $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
    Write-Host "OK Decoder created" -ForegroundColor Green
    
    $bitmapTask = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Invoke-AsTask $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
    Write-Host "OK Bitmap loaded: $($bitmap.PixelWidth)x$($bitmap.PixelHeight)" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "[6/6] Running OCR..." -ForegroundColor Cyan
    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $ocrEngine) {
        Write-Host "Trying alternative language method..." -ForegroundColor Yellow
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::CurrentInputMethodLanguageTag)
    }
    
    if ($null -eq $ocrEngine) {
        throw "Could not create OCR engine. Please install OCR language pack from Windows Settings > Time & Language > Language"
    }
    Write-Host "OK OCR engine created" -ForegroundColor Green
    
    Write-Host "Recognizing text..." -ForegroundColor Yellow
    $ocrResultTask = $ocrEngine.RecognizeAsync($bitmap)
    $ocrResult = Invoke-AsTask $ocrResultTask ([Windows.Media.Ocr.OcrResult])
    
    $lineCount = $ocrResult.Lines.Count
    Write-Host "OK Found $lineCount text lines" -ForegroundColor Green
    
    # Extract text
    $textLines = @()
    foreach ($line in $ocrResult.Lines) {
        $words = @()
        foreach ($word in $line.Words) {
            if ($null -ne $word.Text -and $word.Text.Trim().Length -gt 0) {
                $words += $word.Text
            }
        }
        if ($words.Count -gt 0) {
            $textLines += ($words -join " ")
        }
    }
    
    $text = $textLines -join [Environment]::NewLine
    Write-Host "OK Extracted $($text.Length) characters" -ForegroundColor Green
    
    $stream.Dispose()
    
    Write-Host ""
    Write-Host "=== RESULT ===" -ForegroundColor Cyan
    if ($text.Length -gt 0) {
        Write-Host $text -ForegroundColor White
        Write-Host ""
        Write-Host "=== END ===" -ForegroundColor Cyan
        Write-Output $text
    } else {
        Write-Host "No text found in image" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "=== END ===" -ForegroundColor Cyan
        Write-Output ""
    }
    
} catch {
    Write-Host ""
    Write-Host "=== ERROR ===" -ForegroundColor Red
    Write-Host "Type: $($_.Exception.GetType().FullName)" -ForegroundColor Red
    Write-Host "Message: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stack: $($_.ScriptStackTrace)" -ForegroundColor Red
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)" -ForegroundColor Red
    }
    Write-Host "============" -ForegroundColor Red
    Write-Output ""
    exit 1
}
