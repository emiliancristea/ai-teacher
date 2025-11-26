# Test OCR script for Windows
# Usage: .\test-ocr.ps1 "path\to\image.png"

param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

$ErrorActionPreference = 'Stop'

try {
    Write-Host "[OCR] Loading Windows Runtime assemblies..." -ForegroundColor Cyan
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    
    # Load System.Runtime.WindowsRuntime to get extension methods
    $runtimeDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $runtimeDll = Join-Path $runtimeDir 'System.Runtime.WindowsRuntime.dll'
    
    Write-Host "[OCR] Loading runtime DLL from: $runtimeDll" -ForegroundColor Yellow
    
    if (-not (Test-Path $runtimeDll)) {
        throw "System.Runtime.WindowsRuntime.dll not found at: $runtimeDll"
    }
    
    $runtimeAssembly = [System.Reflection.Assembly]::LoadFrom($runtimeDll)
    if ($null -eq $runtimeAssembly) {
        throw "Failed to load System.Runtime.WindowsRuntime.dll"
    }
    
    Write-Host "[OCR] Runtime assembly loaded successfully" -ForegroundColor Green
    
    # Load System.Runtime.WindowsRuntime from .NET Core/5+ location
    # For .NET Framework, we need to use a different approach
    $netCoreRuntimeDll = Join-Path $runtimeDir 'System.Runtime.WindowsRuntime.dll'
    
    # Try loading from .NET Core location if available
    $netCorePath = "$env:ProgramFiles\dotnet\shared\Microsoft.WindowsDesktop.App"
    if (Test-Path $netCorePath) {
        $latestVersion = Get-ChildItem $netCorePath | Sort-Object Name -Descending | Select-Object -First 1
        if ($null -ne $latestVersion) {
            $netCoreRuntimeDll = Join-Path $latestVersion.FullName 'System.Runtime.WindowsRuntime.dll'
        }
    }
    
    # Try to find AsTask extension method
    $asTaskMethod = $null
    $extensionType = $null
    
    # Method 1: Try System.WindowsRuntimeSystemExtensions (found in the assembly)
    $extensionType = $runtimeAssembly.GetType('System.WindowsRuntimeSystemExtensions')
    if ($null -ne $extensionType) {
        Write-Host "[OCR] Found System.WindowsRuntimeSystemExtensions" -ForegroundColor Green
        # Find the generic AsTask<T> method that takes IAsyncOperation<T>
        $asTaskMethods = $extensionType.GetMethods() | Where-Object { 
            $_.Name -eq 'AsTask' -and 
            $_.GetParameters().Count -eq 1 -and
            $_.IsGenericMethodDefinition
        }
        if ($null -ne $asTaskMethods -and $asTaskMethods.Count -gt 0) {
            $asTaskMethod = $asTaskMethods | Select-Object -First 1
            Write-Host "[OCR] Found generic AsTask method: $($asTaskMethod)" -ForegroundColor Green
        } else {
            Write-Host "[OCR] Listing all AsTask methods for debugging:" -ForegroundColor Yellow
            $extensionType.GetMethods() | Where-Object { $_.Name -eq 'AsTask' } | ForEach-Object {
                Write-Host "  - $($_.ToString()) (IsGeneric: $($_.IsGenericMethodDefinition))" -ForegroundColor Gray
            }
            throw "Could not find generic AsTask method"
        }
    }
    
    # Always use C# helper class for better COM interop support
    Write-Host "[OCR] Compiling C# helper class for COM interop..." -ForegroundColor Yellow
    try {
        Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices.WindowsRuntime;
            using System.Threading.Tasks;
            using Windows.Foundation;
            
            public static class AsyncHelper {
                public static T GetResult<T>(object asyncOperation) {
                    // Cast COM object to IAsyncOperation<T>
                    var asyncOp = (IAsyncOperation<T>)asyncOperation;
                    return asyncOp.AsTask().Result;
                }
            }
"@ -ReferencedAssemblies @(
    'System.Runtime.WindowsRuntime.dll',
    'Windows.Foundation.winmd',
    'Windows.Storage.winmd',
    'Windows.Graphics.Imaging.winmd',
    'Windows.Media.winmd'
) -ErrorAction Stop
        Write-Host "[OCR] C# helper class compiled successfully" -ForegroundColor Green
        $useCSharpHelper = $true
    } catch {
        Write-Host "[OCR] C# helper compilation failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "[OCR] Trying without referenced assemblies..." -ForegroundColor Yellow
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
            Write-Host "[OCR] C# helper class compiled successfully (without explicit references)" -ForegroundColor Green
            $useCSharpHelper = $true
        } catch {
            Write-Host "[OCR] C# helper compilation failed: $($_.Exception.Message)" -ForegroundColor Red
            $useCSharpHelper = $false
        }
    }
    
    # Load Windows Runtime types
    Write-Host "[OCR] Loading Windows Runtime types..." -ForegroundColor Cyan
    [Windows.Media.Ocr.OcrEngine, Windows.Media, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    
    Write-Host "[OCR] Windows Runtime types loaded" -ForegroundColor Green
    
    # Convert to absolute path (required by Windows.Storage.StorageFile)
    $absoluteImagePath = (Resolve-Path $ImagePath -ErrorAction Stop).Path
    Write-Host "[OCR] Original path: $ImagePath" -ForegroundColor Gray
    Write-Host "[OCR] Absolute path: $absoluteImagePath" -ForegroundColor Gray
    
    if (-not (Test-Path $absoluteImagePath)) {
        throw "Image file not found: $absoluteImagePath"
    }
    
    Write-Host "[OCR] Loading image from: $absoluteImagePath" -ForegroundColor Cyan
    
    # Helper function to convert async operations
    function Convert-AsyncOperation {
        param($asyncOp)
        
        # COM objects need special handling - get the actual interface type
        $comType = $asyncOp.GetType()
        Write-Host "[OCR] Async operation type: $($comType.FullName)" -ForegroundColor Gray
        
        # Try to get the interface that this COM object implements
        $interfaces = $comType.GetInterfaces()
        $asyncInterface = $interfaces | Where-Object { 
            $_.Name -like '*IAsyncOperation*' -or 
            $_.Name -like '*IAsyncAction*' 
        } | Select-Object -First 1
        
        if ($null -ne $asyncInterface) {
            Write-Host "[OCR] Found interface: $($asyncInterface.FullName)" -ForegroundColor Gray
            $genericArgs = $asyncInterface.GetGenericArguments()
        } else {
            # Fallback: try to get generic args from the type itself
            $genericArgs = $comType.GetGenericArguments()
        }
        
        if ($null -eq $genericArgs -or $genericArgs.Count -eq 0) {
            # Last resort: try to infer from method signatures
            Write-Host "[OCR] Trying to infer generic type from GetResults method..." -ForegroundColor Yellow
            try {
                $getResultsMethod = $comType.GetMethod('GetResults')
                if ($null -ne $getResultsMethod) {
                    $genericArgs = @($getResultsMethod.ReturnType)
                    Write-Host "[OCR] Inferred type: $($genericArgs[0].FullName)" -ForegroundColor Green
                }
            } catch {
                Write-Host "[OCR] Could not infer type: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        
        if ($null -eq $genericArgs -or $genericArgs.Count -eq 0) {
            throw "Could not determine generic type argument. Type: $($comType.FullName), Interfaces: $($interfaces | ForEach-Object { $_.FullName } | Out-String)"
        }
        
        Write-Host "[OCR] Using generic type: $($genericArgs[0].FullName)" -ForegroundColor Green
        
        if ($useCSharpHelper) {
            # Use C# helper class
            $helperMethod = [AsyncHelper].GetMethod('GetResult').MakeGenericMethod($genericArgs[0])
            return $helperMethod.Invoke($null, @($asyncOp))
        }
        
        # Use AsTask method via reflection
        $genericMethod = $asTaskMethod.MakeGenericMethod($genericArgs[0])
        $task = $genericMethod.Invoke($null, @($asyncOp))
        
        if ($null -eq $task) {
            throw "AsTask returned null"
        }
        
        return $task.Result
    }
    
    # Helper function using reflection to call AsTask on COM objects
    function Invoke-AsTask {
        param($asyncOp, [Type]$resultType)
        
        if ($null -eq $asyncOp) {
            throw "Async operation is null"
        }
        
        Write-Host "[OCR] Invoking AsTask for type: $($resultType.FullName)" -ForegroundColor Gray
        $genericMethod = $asTaskMethod.MakeGenericMethod($resultType)
        $task = $genericMethod.Invoke($null, @($asyncOp))
        
        if ($null -eq $task) {
            throw "AsTask returned null Task"
        }
        
        Write-Host "[OCR] Waiting for task result..." -ForegroundColor Gray
        $result = $task.Result
        
        if ($null -eq $result) {
            Write-Host "[OCR] Warning: Task.Result is null" -ForegroundColor Yellow
        }
        
        return $result
    }
    
    Write-Host "[OCR] Step 1: Getting file from path..." -ForegroundColor Yellow
    $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($absoluteImagePath)
    $file = Invoke-AsTask $fileTask ([Windows.Storage.StorageFile])
    Write-Host "[OCR] File loaded successfully" -ForegroundColor Green
    
    Write-Host "[OCR] Step 2: Opening file stream..." -ForegroundColor Yellow
    if ($null -eq $file) {
        throw "File is null after loading"
    }
    Write-Host "[OCR] File type: $($file.GetType().FullName)" -ForegroundColor Gray
    $streamTask = $file.OpenReadAsync()
    if ($null -eq $streamTask) {
        throw "OpenReadAsync returned null"
    }
    Write-Host "[OCR] Stream task type: $($streamTask.GetType().FullName)" -ForegroundColor Gray
    # Try IRandomAccessStream first, fallback to IRandomAccessStreamWithContentType
    try {
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
    } catch {
        Write-Host "[OCR] Trying IRandomAccessStreamWithContentType..." -ForegroundColor Yellow
        $stream = Invoke-AsTask $streamTask ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    }
    Write-Host "[OCR] Stream opened successfully" -ForegroundColor Green
    
    Write-Host "[OCR] Step 3: Creating bitmap decoder..." -ForegroundColor Yellow
    $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoder = Invoke-AsTask $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
    Write-Host "[OCR] Decoder created successfully" -ForegroundColor Green
    
    Write-Host "[OCR] Step 4: Getting software bitmap..." -ForegroundColor Yellow
    $bitmapTask = $decoder.GetSoftwareBitmapAsync()
    $bitmap = Invoke-AsTask $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
    Write-Host "[OCR] Image loaded: $($bitmap.PixelWidth)x$($bitmap.PixelHeight)" -ForegroundColor Green
    
    Write-Host "[OCR] Step 5: Creating OCR engine..." -ForegroundColor Yellow
    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $ocrEngine) {
        Write-Host "[OCR] Trying alternative language method..." -ForegroundColor Yellow
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::CurrentInputMethodLanguageTag)
    }
    
    if ($null -eq $ocrEngine) {
        throw "Could not create OCR engine - language pack may be missing. Try installing OCR language pack from Windows Settings > Time & Language > Language > Add a language"
    }
    
    Write-Host "[OCR] OCR engine created successfully" -ForegroundColor Green
    
    Write-Host "[OCR] Step 6: Recognizing text..." -ForegroundColor Yellow
    $ocrResultTask = $ocrEngine.RecognizeAsync($bitmap)
    $ocrResult = Invoke-AsTask $ocrResultTask ([Windows.Media.Ocr.OcrResult])
    $lineCount = $ocrResult.Lines.Count
    Write-Host "[OCR] Found $lineCount text lines" -ForegroundColor Green
    
    $text = ($ocrResult.Lines | ForEach-Object { 
        $_.Words | ForEach-Object { $_.Text } 
    } | Where-Object { $_ -ne $null }) -join " "
    
    Write-Host "[OCR] Extracted $($text.Length) characters" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== EXTRACTED TEXT ===" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor White
    Write-Host "======================" -ForegroundColor Cyan
    
    $stream.Dispose()
    
    return $text
    
} catch {
    Write-Host ""
    Write-Host "=== ERROR ===" -ForegroundColor Red
    Write-Host "Type: $($_.Exception.GetType().FullName)" -ForegroundColor Red
    Write-Host "Message: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
    if ($_.Exception.InnerException) {
        Write-Host "Inner Exception: $($_.Exception.InnerException.Message)" -ForegroundColor Red
    }
    Write-Host "============" -ForegroundColor Red
    exit 1
}

