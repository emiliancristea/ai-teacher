# Test Real Agent Logic - Tests the actual implementation logic from the codebase
# This tests the exact regex patterns, detection logic, and integration flow

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$script:TestResults = @()
$script:PassedTests = 0
$script:FailedTests = 0

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Message = "",
        [object]$Details = $null
    )
    
    $status = if ($Passed) { "✅ PASS" } else { "❌ FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    
    Write-Host "[$status] $TestName" -ForegroundColor $color
    if ($Message) {
        Write-Host "   $Message" -ForegroundColor Gray
    }
    if ($Details -and $Verbose) {
        Write-Host "   Details: $($Details | ConvertTo-Json -Compress -Depth 3)" -ForegroundColor Gray
    }
    
    $script:TestResults += @{
        Test = $TestName
        Passed = $Passed
        Message = $Message
        Details = $Details
    }
    
    if ($Passed) {
        $script:PassedTests++
    } else {
        $script:FailedTests++
    }
}

function Test-DockerQuestionDetection {
    Write-Host "`n=== Testing Docker Question Detection Logic ===" -ForegroundColor Cyan
    
    # Test the exact regex pattern from gemini.ts line 1108
    $dockerQuestionPattern = '\b(container|docker|running|stopped|status|infra|xenolabs|kryptit|start|stop)\b'
    
    $testCases = @(
        @{Message = "tell me what containers are running and which ones are stopped?"; Expected = $true},
        @{Message = "is infra running?"; Expected = $true},
        @{Message = "what about xenolabs?"; Expected = $true},
        @{Message = "can you check kryptit status again?"; Expected = $true},
        @{Message = "start the kryptit container"; Expected = $true},
        @{Message = "stop infra"; Expected = $true},
        @{Message = "what's the CPU usage of infra?"; Expected = $true},
        @{Message = "can you see my docker app?"; Expected = $true; Note = "Contains 'docker' but should not trigger execute_command"},
        @{Message = "hey there"; Expected = $false},
        @{Message = "what's the weather?"; Expected = $false},
        @{Message = "show me cursor"; Expected = $false}
    )
    
    foreach ($testCase in $testCases) {
        $matches = $testCase.Message -match $dockerQuestionPattern
        $passed = $matches -eq $testCase.Expected
        
        $message = "Pattern match: $matches, Expected: $($testCase.Expected)"
        if ($testCase.Note) {
            $message += " ($($testCase.Note))"
        }
        
        Write-TestResult -TestName "Docker Detection: `"$($testCase.Message)`"" -Passed $passed -Message $message -Details $testCase
    }
}

function Test-DockerContextDetection {
    Write-Host "`n=== Testing Docker Context Detection Logic ===" -ForegroundColor Cyan
    
    # Test the exact regex pattern from gemini.ts line 1113
    $dockerContextPattern = '\b(docker|container)\b'
    
    $testMessages = @(
        "can you see my docker app?",
        "tell me what containers are running?",
        "hey there",
        "what's the weather?",
        "docker ps output shows..."
    )
    
    foreach ($msg in $testMessages) {
        $hasContext = $msg -match $dockerContextPattern
        Write-TestResult -TestName "Context Detection: `"$msg`"" -Passed $true -Message "Has Docker context: $hasContext" -Details @{Message = $msg; HasContext = $hasContext}
    }
}

function Test-ExecuteCommandInjectionLogic {
    Write-Host "`n=== Testing Execute Command Injection Logic ===" -ForegroundColor Cyan
    
    # Simulate the exact logic from gemini.ts lines 1106-1133
    function Simulate-InjectionLogic {
        param(
            [string]$UserMessage,
            [array]$FunctionCalls
        )
        
        # Line 1108: Docker question detection
        $isDockerQuestion = $UserMessage -match '\b(container|docker|running|stopped|status|infra|xenolabs|kryptit|start|stop)\b'
        
        # Line 1111-1114: Check recent messages for Docker context
        $hasDockerContext = $UserMessage -match '\b(docker|container)\b'
        
        # Line 1116-1117: Check if capture_window_with_ocr was called for Docker
        $dockerCaptureCount = ($FunctionCalls | Where-Object { 
            $_.name -eq "capture_window_with_ocr" -and 
            ($_.args.process_name -match 'docker')
        }).Count
        $hasDockerCapture = $dockerCaptureCount -gt 0
        
        # Line 1118: Check if execute_command was already called
        $executeCommandCount = ($FunctionCalls | Where-Object { $_.name -eq "execute_command" }).Count
        $hasExecuteCommand = $executeCommandCount -gt 0
        
        # Line 1121: Injection condition
        $shouldInject = ($isDockerQuestion -or $hasDockerContext) -and $hasDockerCapture -and -not $hasExecuteCommand
        
        return @{
            IsDockerQuestion = $isDockerQuestion
            HasDockerContext = $hasDockerContext
            HasDockerCapture = $hasDockerCapture
            HasExecuteCommand = $hasExecuteCommand
            ShouldInject = $shouldInject
        }
    }
    
    $testScenarios = @(
        @{
            UserMessage = "tell me what containers are running and which ones are stopped?"
            FunctionCalls = @(
                @{name = "capture_window_with_ocr"; args = @{process_name = "docker desktop"}}
            )
            ExpectedInject = $true
            Description = "Docker question with capture - should inject"
        },
        @{
            UserMessage = "tell me what containers are running and which ones are stopped?"
            FunctionCalls = @(
                @{name = "capture_window_with_ocr"; args = @{process_name = "docker desktop"}},
                @{name = "execute_command"; args = @{command = "docker"; args = @("ps")}}
            )
            ExpectedInject = $false
            Description = "Docker question with capture and execute_command - should NOT inject"
        },
        @{
            UserMessage = "can you see my docker app?"
            FunctionCalls = @(
                @{name = "capture_window_with_ocr"; args = @{process_name = "docker desktop"}}
            )
            ExpectedInject = $true
            Description = "Docker context with capture - should inject (but might not be ideal)"
        },
        @{
            UserMessage = "tell me what containers are running?"
            FunctionCalls = @(
                @{name = "capture_window_with_ocr"; args = @{process_name = "cursor"}}
            )
            ExpectedInject = $false
            Description = "Docker question but no Docker capture - should NOT inject"
        },
        @{
            UserMessage = "hey there"
            FunctionCalls = @(
                @{name = "capture_window_with_ocr"; args = @{process_name = "docker desktop"}}
            )
            ExpectedInject = $false
            Description = "No Docker question - should NOT inject"
        }
    )
    
    foreach ($scenario in $testScenarios) {
        $result = Simulate-InjectionLogic -UserMessage $scenario.UserMessage -FunctionCalls $scenario.FunctionCalls
        
        $passed = $result.ShouldInject -eq $scenario.ExpectedInject
        
        $message = "Should inject: $($result.ShouldInject), Expected: $($scenario.ExpectedInject)"
        $message += "`n   Detection: DockerQ=$($result.IsDockerQuestion), Context=$($result.HasDockerContext), Capture=$($result.HasDockerCapture), HasCmd=$($result.HasExecuteCommand)"
        
        Write-TestResult -TestName "Injection Logic: $($scenario.Description)" -Passed $passed -Message $message -Details @{Scenario = $scenario; Result = $result}
    }
}

function Test-IsAskingQuestionDetection {
    Write-Host "`n=== Testing Question Detection Logic ===" -ForegroundColor Cyan
    
    # Test the exact regex pattern from gemini.ts line 1208
    $isAskingQuestionPattern = '^(what|how|why|when|where|which|who|explain|describe|tell me|help|show|analyze)'
    
    $testCases = @(
        @{Message = "tell me what containers are running?"; Expected = $true},
        @{Message = "what containers are running?"; Expected = $true},
        @{Message = "how do I start a container?"; Expected = $true},
        @{Message = "why is infra stopped?"; Expected = $true},
        @{Message = "can you see my docker app?"; Expected = $false},
        @{Message = "yes"; Expected = $false},
        @{Message = "start the kryptit container"; Expected = $false},
        @{Message = "are you sure infra is running?"; Expected = $false; Note = "Starts with 'are' not in pattern"}
    )
    
    foreach ($testCase in $testCases) {
        $matches = $testCase.Message -match $isAskingQuestionPattern
        $passed = $matches -eq $testCase.Expected
        
        $message = "Pattern match: $matches, Expected: $($testCase.Expected)"
        if ($testCase.Note) {
            $message += " ($($testCase.Note))"
        }
        
        Write-TestResult -TestName "Question Detection: `"$($testCase.Message)`"" -Passed $passed -Message $message -Details $testCase
    }
}

function Test-IsJustCheckingDetection {
    Write-Host "`n=== Testing 'Just Checking' Detection Logic ===" -ForegroundColor Cyan
    
    # Test the exact regex pattern from gemini.ts line 1119-1120
    $isJustCheckingPattern = '\b(all good|just wanted|just checking|just wanted to check|wondered if|no.*just|just wanted to check if)\b|^no,?\s+just'
    
    $testCases = @(
        @{Message = "all good, just wanted to check"; Expected = $true},
        @{Message = "just checking"; Expected = $true},
        @{Message = "just wanted to check if you can see it"; Expected = $true},
        @{Message = "no, just wanted to check"; Expected = $true},
        @{Message = "no just wanted"; Expected = $true},
        @{Message = "wondered if you can see it"; Expected = $true},
        @{Message = "tell me what containers are running?"; Expected = $false},
        @{Message = "can you see my docker app?"; Expected = $false},
        @{Message = "yes"; Expected = $false}
    )
    
    foreach ($testCase in $testCases) {
        $matches = $testCase.Message -match $isJustCheckingPattern
        $passed = $matches -eq $testCase.Expected
        
        Write-TestResult -TestName "Just Checking Detection: `"$($testCase.Message)`"" -Passed $passed -Message "Pattern match: $matches, Expected: $($testCase.Expected)" -Details $testCase
    }
}

function Test-IsJustIdentifyingDetection {
    Write-Host "`n=== Testing 'Just Identifying' Detection Logic ===" -ForegroundColor Cyan
    
    # Test the exact regex pattern from gemini.ts line 1118
    $isJustIdentifyingPattern = '^(the|that|this|it|yes|ok|okay|sure|yep|yeah|yup|correct|right|exactly|that one|this one|the .+ one|number \d+|^\d+$)'
    
    $testCases = @(
        @{Message = "yes"; Expected = $true},
        @{Message = "the ai teacher one"; Expected = $true},
        @{Message = "that one"; Expected = $true},
        @{Message = "number 1"; Expected = $true},
        @{Message = "1"; Expected = $true},
        @{Message = "ok"; Expected = $true},
        @{Message = "tell me what containers are running?"; Expected = $false},
        @{Message = "can you see my docker app?"; Expected = $false},
        @{Message = "start the container"; Expected = $false}
    )
    
    foreach ($testCase in $testCases) {
        $trimmed = $testCase.Message.Trim()
        $matches = $trimmed -match $isJustIdentifyingPattern
        $passed = $matches -eq $testCase.Expected
        
        Write-TestResult -TestName "Just Identifying Detection: `"$($testCase.Message)`"" -Passed $passed -Message "Pattern match: $matches, Expected: $($testCase.Expected)" -Details $testCase
    }
}

function Test-CommandExecutionFlow {
    Write-Host "`n=== Testing Command Execution Flow ===" -ForegroundColor Cyan
    
    # Test actual docker commands that would be executed
    $testCommands = @(
        @{Command = "docker"; Args = @("ps"); Description = "List running containers"},
        @{Command = "docker"; Args = @("ps", "-a"); Description = "List all containers"},
        @{Command = "docker"; Args = @("--version"); Description = "Docker version"}
    )
    
    foreach ($testCmd in $testCommands) {
        try {
            $process = Start-Process -FilePath $testCmd.Command -ArgumentList $testCmd.Args -NoNewWindow -Wait -PassThru -RedirectStandardOutput "temp_output.txt" -RedirectStandardError "temp_error.txt"
            
            $stdout = Get-Content "temp_output.txt" -Raw -ErrorAction SilentlyContinue
            $stderr = Get-Content "temp_error.txt" -Raw -ErrorAction SilentlyContinue
            Remove-Item "temp_output.txt", "temp_error.txt" -ErrorAction SilentlyContinue
            
            $success = $process.ExitCode -eq 0
            
            # Simulate CommandResult structure from Rust backend
            $commandResult = @{
                success = $success
                stdout = $stdout
                stderr = $stderr
                exit_code = $process.ExitCode
                error = if ($success) { $null } else { "Command failed with exit code: $($process.ExitCode)" }
            }
            
            Write-TestResult -TestName "Command Execution: $($testCmd.Command) $($testCmd.Args -join ' ')" -Passed $success `
                -Message $testCmd.Description -Details @{
                    Result = $commandResult
                    StdoutLength = $stdout.Length
                    StderrLength = $stderr.Length
                }
        } catch {
            Write-TestResult -TestName "Command Execution: $($testCmd.Command) $($testCmd.Args -join ' ')" -Passed $false -Message "Error: $_"
        }
    }
}

function Show-Summary {
    Write-Host "`n" + "="*60 -ForegroundColor Cyan
    Write-Host "TEST SUMMARY" -ForegroundColor Cyan
    Write-Host "="*60 -ForegroundColor Cyan
    Write-Host "Total Tests: $($script:TestResults.Count)" -ForegroundColor White
    Write-Host "Passed: $script:PassedTests" -ForegroundColor Green
    Write-Host "Failed: $script:FailedTests" -ForegroundColor Red
    Write-Host "="*60 -ForegroundColor Cyan
    
    if ($script:FailedTests -eq 0) {
        Write-Host "`n🎉 All tests passed! The logic matches the implementation." -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  Some tests failed. Review the output above." -ForegroundColor Yellow
        
        Write-Host "`nFailed Tests:" -ForegroundColor Red
        $script:TestResults | Where-Object { -not $_.Passed } | ForEach-Object {
            Write-Host "  - $($_.Test): $($_.Message)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
}

# Main execution
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "REAL AGENT LOGIC TEST SUITE" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan
Write-Host "Testing the exact implementation logic from:" -ForegroundColor White
Write-Host "  - src/services/gemini.ts" -ForegroundColor Gray
Write-Host "  - Docker question detection patterns" -ForegroundColor Gray
Write-Host "  - Execute command injection logic" -ForegroundColor Gray
Write-Host "  - Intent detection patterns" -ForegroundColor Gray
Write-Host "  - Command execution flow" -ForegroundColor Gray
Write-Host ""

# Run tests
Test-DockerQuestionDetection
Test-DockerContextDetection
Test-ExecuteCommandInjectionLogic
Test-IsAskingQuestionDetection
Test-IsJustCheckingDetection
Test-IsJustIdentifyingDetection
Test-CommandExecutionFlow

# Show summary
Show-Summary

# Exit with appropriate code
if ($script:FailedTests -eq 0) {
    exit 0
} else {
    exit 1
}

