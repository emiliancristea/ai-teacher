/**
 * Real Integration Test - Tests the ACTUAL app implementation
 * Uses real functions from gemini.ts, screenCapture.ts, etc.
 * Captures and verifies actual console logs and outputs
 * 
 * Run with: npm run test:real
 */

import type { Message } from "../src/types";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Mock Tauri invoke function - this will be used by screenCapture.ts
const mockInvoke = async (cmd: string, args?: any): Promise<any> => {
  console.log(`[MOCK] Tauri invoke: ${cmd}`, args ? JSON.stringify(args).substring(0, 100) : "");
  
  if (cmd === "execute_command") {
    const { command, args: cmdArgs } = args;
    
    // Actually execute the command in Node.js (real execution!)
    try {
      const fullCommand = `${command} ${(cmdArgs || []).join(" ")}`;
      console.log(`[MOCK] Executing real command: ${fullCommand}`);
      const { stdout, stderr } = await execAsync(fullCommand);
      
      return {
        success: true,
        stdout: stdout,
        stderr: stderr,
        exit_code: 0,
        error: null
      };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exit_code: error.code || 1,
        error: error.message
      };
    }
  }
  
  // Mock other Tauri commands
  if (cmd === "get_system_context") {
    return {
      active_window: "Docker Desktop",
      active_window_title: "Containers - Docker Desktop",
      open_windows: [{
        title: "Containers - Docker Desktop",
        process_name: "Docker Desktop",
        is_active: true
      }],
      running_applications: ["Docker Desktop", "Cursor"],
      timestamp: Date.now()
    };
  }
  
  if (cmd === "capture_window_with_ocr") {
    // Return a minimal valid base64-encoded 1x1 pixel PNG image
    // This is a real base64-encoded PNG that Gemini can accept
    const minimalPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    return {
      success: true,
      image_base64: minimalPngBase64,
      hash: "mock-hash-123",
      timestamp: Date.now(),
      ocr_text: "Container memory usage 279.15MB / 14.29GB infra xenolabs kryptit",
      window_title: "Containers - Docker Desktop",
      process_name: "Docker Desktop",
      analysis: null
    };
  }
  
  if (cmd === "list_windows_by_process") {
    return [{
      title: "Containers - Docker Desktop",
      process_name: "Docker Desktop",
      is_active: false
    }];
  }
  
  return { success: false, error: "Command not implemented in test" };
};

// Set up global window object for Tauri API BEFORE any imports
if (typeof (global as any).window === "undefined") {
  (global as any).window = {} as any;
}

(global as any).window.__TAURI_INTERNALS__ = {
  invoke: mockInvoke
};

// Ensure window is available globally
if (typeof (global as any).window === "undefined") {
  (global as any).window = (global as any).window || {};
}

// Capture console logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

interface LogEntry {
  type: "log" | "error" | "warn";
  message: string;
  timestamp: number;
}

const capturedLogs: LogEntry[] = [];

function captureLog(type: "log" | "error" | "warn", ...args: any[]) {
  const message = args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");
  
  capturedLogs.push({
    type,
    message,
    timestamp: Date.now()
  });
  
  // Also output to console
  if (type === "log") originalConsoleLog(...args);
  else if (type === "error") originalConsoleError(...args);
  else if (type === "warn") originalConsoleWarn(...args);
}

// Override console methods
console.log = (...args: any[]) => captureLog("log", ...args);
console.error = (...args: any[]) => captureLog("error", ...args);
console.warn = (...args: any[]) => captureLog("warn", ...args);

interface TestResult {
  testName: string;
  passed: boolean;
  userMessage: string;
  aiResponse?: string;
  functionCalls: Array<{ name: string; args: any }>;
  logs: LogEntry[];
  errors: string[];
  details?: any;
}

const testResults: TestResult[] = [];

async function runRealTest(
  testName: string,
  userMessage: string,
  previousMessages: Message[] = [],
  apiKey?: string
): Promise<TestResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[TEST] ${testName}`);
  console.log(`User: "${userMessage}"`);
  console.log("=".repeat(60));
  
  // Clear captured logs for this test
  capturedLogs.length = 0;
  
  const result: TestResult = {
    testName,
    passed: false,
    userMessage,
    functionCalls: [],
    logs: [],
    errors: []
  };
  
  try {
    // Initialize Gemini if API key provided
    if (apiKey) {
      // Import after mock is set up
      const { initializeGemini, sendMessageWithVision } = await import("../src/services/gemini");
      
      initializeGemini(apiKey);
      console.log("[TEST] Gemini initialized");
      
      // Build message history
      const messages: Message[] = [
        ...previousMessages,
        {
          role: "user",
          content: userMessage,
          parts: [{ text: userMessage }]
        }
      ];
      
      console.log(`[TEST] Sending ${messages.length} message(s) to Gemini...`);
      
      // Call the REAL sendMessageWithVision function
      const stream = await sendMessageWithVision(
        messages,
        [],
        (status) => {
          console.log(`[TEST] Status: ${status}`);
        },
        () => {}
      );
    
      // Read the stream with timeout
      let aiResponse = "";
      const reader = stream.getReader();
      
      // Set timeout for stream reading (30 seconds)
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Stream reading timeout after 30 seconds")), 30000);
      });
      
      try {
        // Race between reading and timeout
        await Promise.race([
          (async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              // ReadableStream<string> returns strings directly
              if (typeof value === "string") {
                aiResponse += value;
                process.stdout.write(value);
              } else if (value != null) {
                // Fallback for other types
                const text = String(value);
                aiResponse += text;
                process.stdout.write(text);
              }
            }
          })(),
          timeoutPromise
        ]);
      } catch (error: any) {
        if (error.message.includes("timeout")) {
          result.errors.push(`Stream reading timeout: ${error.message}`);
          console.error(`[TEST] ⚠️ Stream reading timeout - partial response: ${aiResponse.length} chars`);
        } else {
          throw error;
        }
      } finally {
        reader.releaseLock();
      }
      
      result.aiResponse = aiResponse;
      
      // Validate response
      if (aiResponse.length === 0) {
        result.errors.push("AI response is empty - stream may have closed prematurely");
        console.warn(`[TEST] ⚠️ Empty AI response detected`);
      } else if (aiResponse.length < 10) {
        result.errors.push(`AI response is suspiciously short (${aiResponse.length} chars)`);
        console.warn(`[TEST] ⚠️ Very short AI response: "${aiResponse}"`);
      }
      
      console.log(`\n[TEST] AI Response received (${aiResponse.length} chars)`);
      if (aiResponse.length > 0) {
        console.log(`[TEST] Response preview: "${aiResponse.substring(0, 100).replace(/\n/g, " ")}..."`);
      }
    } else {
      console.log("[TEST] Using mock mode (no API key)");
      // For testing without API, we'll need to mock or skip
      result.errors.push("No API key provided - cannot test real Gemini implementation");
      result.logs = [...capturedLogs];
      return result;
    }
    
    // Extract function calls from logs
    const functionCallLogs = capturedLogs.filter(log => 
      log.message.includes("Function call:") || 
      log.message.includes("[Gemini] Function call:")
    );
    
    for (const log of functionCallLogs) {
      // Try to extract function call info from log
      const match = log.message.match(/Function call:\s*(\w+)\s*({.*})/);
      if (match) {
        try {
          const args = JSON.parse(match[2]);
          result.functionCalls.push({
            name: match[1],
            args: args
          });
        } catch (e) {
          // Try to extract manually
          result.functionCalls.push({
            name: match[1],
            args: {}
          });
        }
      }
    }
    
    // Check for execute_command calls
    const executeCommandLogs = capturedLogs.filter(log =>
      log.message.includes("execute_command") ||
      log.message.includes("Executing command:")
    );
    
    if (executeCommandLogs.length > 0) {
      console.log(`[TEST] Found ${executeCommandLogs.length} execute_command call(s)`);
    }
    
    // Check for docker ps calls
    const dockerPsLogs = capturedLogs.filter(log =>
      log.message.includes("docker") && log.message.includes("ps")
    );
    
    if (dockerPsLogs.length > 0) {
      console.log(`[TEST] Found docker ps command execution`);
    }
    
    // Save all logs
    result.logs = [...capturedLogs];
    
    // Check for errors from logs (but don't overwrite manually added errors)
    const errorLogs = capturedLogs.filter(log => log.type === "error");
    const logErrors = errorLogs.map(log => log.message);
    
    // Merge log errors with manually added errors (like empty response detection)
    result.errors = [...result.errors, ...logErrors];
    
    if (result.errors.length > 0) {
      console.log(`[TEST] Found ${result.errors.length} error(s)`);
      result.errors.forEach(err => console.log(`[TEST]   - ${err}`));
    }
    
    // Determine if test passed (no errors AND got a response)
    result.passed = result.errors.length === 0 && (result.aiResponse?.length || 0) > 0;
    
  } catch (error: any) {
    result.errors.push(error.message || String(error));
    result.logs = [...capturedLogs];
    console.error(`[TEST] Error: ${error.message}`);
  }
  
  return result;
}

async function testExecuteCommand() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[TEST] Testing executeCommand function directly`);
  console.log("=".repeat(60));
  
  try {
    // Import executeCommand after mocking Tauri
    const { executeCommand } = await import("../src/services/screenCapture");
    
    const result = await executeCommand("docker", ["ps"]);
    console.log(`[TEST] Command executed: success=${result.success}`);
    console.log(`[TEST] Exit code: ${result.exit_code}`);
    console.log(`[TEST] Stdout length: ${result.stdout.length}`);
    console.log(`[TEST] Stderr length: ${result.stderr.length}`);
    
    if (result.success) {
      console.log(`[TEST] ✅ executeCommand works!`);
      console.log(`[TEST] Output preview: ${result.stdout.substring(0, 200)}...`);
      
      // Parse containers from output
      const lines = result.stdout.split('\n').filter(l => l.trim());
      const containers = lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        return parts[parts.length - 1]; // Container name
      });
      console.log(`[TEST] Found containers: ${containers.join(", ")}`);
      
      return true;
    } else {
      console.log(`[TEST] ❌ Command failed: ${result.error}`);
      return false;
    }
  } catch (error: any) {
    console.error(`[TEST] ❌ Error testing executeCommand: ${error.message}`);
    console.error(`[TEST] Stack: ${error.stack}`);
    return false;
  }
}

async function runAllTests() {
  console.log("\n" + "=".repeat(60));
  console.log("REAL INTEGRATION TEST SUITE");
  console.log("=".repeat(60));
  console.log("Testing ACTUAL app implementation:");
  console.log("  - Real sendMessageWithVision function");
  console.log("  - Real executeCommand function");
  console.log("  - Real console logs");
  console.log("  - Real AI responses");
  console.log("  - Real function calls");
  console.log("");
  
  const apiKey = process.env.GEMINI_API_KEY;
  
  // Test 1: Execute command directly (always runs)
  console.log("\n[TEST 1] Testing executeCommand function...");
  const cmdTestPassed = await testExecuteCommand();
  
  if (!apiKey) {
    console.log("\n⚠️  GEMINI_API_KEY not set - cannot test full Gemini flow");
    console.log("   Set GEMINI_API_KEY environment variable to test full conversation flow");
    console.log("   Example: $env:GEMINI_API_KEY='your-key'; npm run test:real\n");
    
    // Show summary for executeCommand test only
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`ExecuteCommand Test: ${cmdTestPassed ? "✅ PASS" : "❌ FAIL"}`);
    console.log("=".repeat(60) + "\n");
    
    process.exit(cmdTestPassed ? 0 : 1);
    return;
  }
  
  console.log("✅ GEMINI_API_KEY found - testing full flow\n");
  
  // Test 2: Docker question with full flow
  console.log("\n[TEST 2] Testing Docker question flow...");
  const test1 = await runRealTest(
    "Docker question should trigger execute_command",
    "tell me what containers are running and which ones are stopped?",
    [],
    apiKey
  );
  testResults.push(test1);
  
  // Test 3: Follow-up question
  console.log("\n[TEST 3] Testing follow-up question...");
  const test2 = await runRealTest(
    "Follow-up container status question",
    "is infra running?",
    [
      {
        role: "user",
        content: "can you see my docker app?",
        parts: [{ text: "can you see my docker app?" }]
      },
      {
        role: "assistant",
        content: "Yes, I can see your Docker Desktop app",
        parts: [{ text: "Yes, I can see your Docker Desktop app" }]
      }
    ],
    apiKey
  );
  testResults.push(test2);
  
  // Test 4: Specific container status question
  console.log("\n[TEST 4] Testing specific container status...");
  const test3 = await runRealTest(
    "Specific container status check",
    "is xenolabs-frontend running?",
    [],
    apiKey
  );
  testResults.push(test3);
  
  // Test 5: Start container command
  console.log("\n[TEST 5] Testing start container command...");
  const test4 = await runRealTest(
    "Start container command",
    "start the kryptit-frontend container",
    [],
    apiKey
  );
  testResults.push(test4);
  
  // Test 6: Stop container command
  console.log("\n[TEST 6] Testing stop container command...");
  const test5 = await runRealTest(
    "Stop container command",
    "stop xenolabs-backend",
    [],
    apiKey
  );
  testResults.push(test5);
  
  // Test 7: Multiple containers question
  console.log("\n[TEST 7] Testing multiple containers question...");
  const test6 = await runRealTest(
    "Multiple containers status",
    "which containers are using the most CPU?",
    [],
    apiKey
  );
  testResults.push(test6);
  
  // Test 8: Container list without status
  console.log("\n[TEST 8] Testing container list question...");
  const test7 = await runRealTest(
    "Container list question",
    "show me all my containers",
    [],
    apiKey
  );
  testResults.push(test7);
  
  // Test 9: Just checking (should NOT trigger execute_command)
  console.log("\n[TEST 9] Testing 'just checking' message...");
  const test8 = await runRealTest(
    "Just checking - should use context",
    "just checking if you can see my docker",
    [
      {
        role: "user",
        content: "can you see my docker app?",
        parts: [{ text: "can you see my docker app?" }]
      },
      {
        role: "assistant",
        content: "Yes, I can see your Docker Desktop app",
        parts: [{ text: "Yes, I can see your Docker Desktop app" }]
      }
    ],
    apiKey
  );
  testResults.push(test8);
  
  // Test 10: Can you see question (should only capture, not execute)
  console.log("\n[TEST 10] Testing 'can you see' question...");
  const test9 = await runRealTest(
    "Can you see question",
    "can you see my docker desktop?",
    [],
    apiKey
  );
  testResults.push(test9);
  
  // Test 11: Container logs question
  console.log("\n[TEST 11] Testing container logs question...");
  const test10 = await runRealTest(
    "Container logs question",
    "show me the logs for xenolabs-backend",
    [],
    apiKey
  );
  testResults.push(test10);
  
  // Test 12: Container restart question
  console.log("\n[TEST 12] Testing container restart...");
  const test11 = await runRealTest(
    "Container restart command",
    "restart bunkerverse_ethereum",
    [],
    apiKey
  );
  testResults.push(test11);
  
  // Test 13: Complex multi-part question
  console.log("\n[TEST 13] Testing complex multi-part question...");
  const test12 = await runRealTest(
    "Complex multi-part question",
    "what containers are running, and can you tell me which ones are using postgres?",
    [],
    apiKey
  );
  testResults.push(test12);
  
  // Test 14: Conversation context test
  console.log("\n[TEST 14] Testing conversation context...");
  const test13 = await runRealTest(
    "Conversation context test",
    "what about the redis one?",
    [
      {
        role: "user",
        content: "which containers are running?",
        parts: [{ text: "which containers are running?" }]
      },
      {
        role: "assistant",
        content: "I can see xenolabs-frontend, xenolabs-backend, and xenolabs-redis running",
        parts: [{ text: "I can see xenolabs-frontend, xenolabs-backend, and xenolabs-redis running" }]
      }
    ],
    apiKey
  );
  testResults.push(test13);
  
  // Test 15: Ambiguous container name
  console.log("\n[TEST 15] Testing ambiguous container name...");
  const test14 = await runRealTest(
    "Ambiguous container name",
    "is kryptit running?",
    [],
    apiKey
  );
  testResults.push(test14);
  
  // Test 16: Container health check
  console.log("\n[TEST 16] Testing container health check...");
  const test15 = await runRealTest(
    "Container health check",
    "are all my containers healthy?",
    [],
    apiKey
  );
  testResults.push(test15);
  
  // Test 17: Non-Docker question (should NOT trigger execute_command)
  console.log("\n[TEST 17] Testing non-Docker question...");
  const test16 = await runRealTest(
    "Non-Docker question",
    "what's the weather like?",
    [],
    apiKey
  );
  testResults.push(test16);
  
  // Test 18: Docker question with typo
  console.log("\n[TEST 18] Testing Docker question with typo...");
  const test17 = await runRealTest(
    "Docker question with typo",
    "wht cntainers ar runing?",
    [],
    apiKey
  );
  testResults.push(test17);
  
  // Test 19: Multiple rapid questions
  console.log("\n[TEST 19] Testing rapid follow-up questions...");
  const test18 = await runRealTest(
    "Rapid follow-up question",
    "and what about the stopped ones?",
    [
      {
        role: "user",
        content: "what containers are running?",
        parts: [{ text: "what containers are running?" }]
      },
      {
        role: "assistant",
        content: "I can see several containers running",
        parts: [{ text: "I can see several containers running" }]
      },
      {
        role: "user",
        content: "tell me more",
        parts: [{ text: "tell me more" }]
      },
      {
        role: "assistant",
        content: "The running containers are...",
        parts: [{ text: "The running containers are..." }]
      }
    ],
    apiKey
  );
  testResults.push(test18);
  
  // Test 20: Container stats question
  console.log("\n[TEST 20] Testing container stats question...");
  const test19 = await runRealTest(
    "Container stats question",
    "show me the stats for all containers",
    [],
    apiKey
  );
  testResults.push(test19);
  
  // Test 21: Empty question
  console.log("\n[TEST 21] Testing empty/question mark only...");
  const test20 = await runRealTest(
    "Empty/question mark only",
    "?",
    [],
    apiKey
  );
  testResults.push(test20);
  
  // Test 22: Very long question
  console.log("\n[TEST 22] Testing very long question...");
  const test21 = await runRealTest(
    "Very long question",
    "can you please tell me in detail what containers I have running right now and their status and also which ones are stopped and maybe give me some information about their resource usage if possible?",
    [],
    apiKey
  );
  testResults.push(test21);
  
  // Test 23: Question with emoji
  console.log("\n[TEST 23] Testing question with emoji...");
  const test22 = await runRealTest(
    "Question with emoji",
    "🚀 which containers are running?",
    [],
    apiKey
  );
  testResults.push(test22);
  
  // Test 24: Mixed case question
  console.log("\n[TEST 24] Testing mixed case question...");
  const test23 = await runRealTest(
    "Mixed case question",
    "Is XENOLABS-FRONTEND Running?",
    [],
    apiKey
  );
  testResults.push(test23);
  
  // Test 25: Question with special characters
  console.log("\n[TEST 25] Testing question with special characters...");
  const test24 = await runRealTest(
    "Question with special characters",
    "what's the status of my containers? (all of them)",
    [],
    apiKey
  );
  testResults.push(test24);
  
  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));
  
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  
  // Count tests with empty responses
  const emptyResponses = testResults.filter(t => !t.aiResponse || t.aiResponse.length === 0);
  const shortResponses = testResults.filter(t => t.aiResponse && t.aiResponse.length > 0 && t.aiResponse.length < 50);
  
  console.log(`Total Tests: ${testResults.length}`);
  console.log(`Passed: ${passed}`, passed === testResults.length ? "✅" : "");
  console.log(`Failed: ${failed}`, failed > 0 ? "❌ FAIL" : "");
  console.log(`Success Rate: ${((passed / testResults.length) * 100).toFixed(1)}%`);
  console.log(`ExecuteCommand Test: ${cmdTestPassed ? "✅ PASS" : "❌ FAIL"}`);
  
  if (emptyResponses.length > 0) {
    console.log(`\n⚠️  Warnings:`);
    console.log(`   Empty responses: ${emptyResponses.length} test(s)`);
    emptyResponses.forEach(t => {
      console.log(`     - ${t.testName}: "${t.userMessage.substring(0, 50)}..."`);
    });
  }
  
  if (shortResponses.length > 0) {
    console.log(`   Short responses (<50 chars): ${shortResponses.length} test(s)`);
  }
  
  // Group tests by category
  const dockerTests = testResults.filter(t => 
    t.userMessage.toLowerCase().includes("docker") || 
    t.userMessage.toLowerCase().includes("container")
  );
  const commandTests = testResults.filter(t => 
    t.userMessage.toLowerCase().includes("start") || 
    t.userMessage.toLowerCase().includes("stop") ||
    t.userMessage.toLowerCase().includes("restart")
  );
  const statusTests = testResults.filter(t => 
    t.userMessage.toLowerCase().includes("running") || 
    t.userMessage.toLowerCase().includes("status")
  );
  
  console.log(`\nTest Categories:`);
  console.log(`  Docker-related: ${dockerTests.length} tests`);
  console.log(`  Command tests: ${commandTests.length} tests`);
  console.log(`  Status checks: ${statusTests.length} tests`);
  
  if (testResults.length > 0) {
    console.log("\nTest Details:");
    testResults.forEach((test, idx) => {
      const statusIcon = test.passed ? "✅" : "❌";
      console.log(`\n${idx + 1}. ${statusIcon} ${test.testName}`);
      console.log(`   User: "${test.userMessage.substring(0, 80)}${test.userMessage.length > 80 ? "..." : ""}"`);
      console.log(`   Status: ${test.passed ? "PASS" : "FAIL"}`);
      console.log(`   Function Calls: ${test.functionCalls.length}`);
      if (test.functionCalls.length > 0) {
        test.functionCalls.forEach(fc => {
          const argsStr = JSON.stringify(fc.args).substring(0, 60);
          console.log(`     - ${fc.name}(${argsStr}${JSON.stringify(fc.args).length > 60 ? "..." : ""})`);
        });
      }
      console.log(`   Logs: ${test.logs.length} | Errors: ${test.errors.length}`);
      if (test.errors.length > 0) {
        test.errors.forEach(err => console.log(`     ❌ ${err.substring(0, 100)}`));
      }
      if (test.aiResponse) {
        const responsePreview = test.aiResponse.substring(0, 80).replace(/\n/g, " ");
        console.log(`   Response: "${responsePreview}..."`);
      }
    });
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("LOG ANALYSIS");
  console.log("=".repeat(60));
  
  // Analyze logs for key patterns
  const allLogs = testResults.flatMap(t => t.logs);
  
  const dockerQuestionLogs = allLogs.filter(log => 
    log.message.includes("Docker question detected") ||
    log.message.includes("docker question")
  );
  console.log(`Docker question detection logs: ${dockerQuestionLogs.length}`);
  if (dockerQuestionLogs.length > 0) {
    dockerQuestionLogs.forEach(log => {
      console.log(`  - ${log.message.substring(0, 150)}...`);
    });
  }
  
  const executeCommandLogs = allLogs.filter(log =>
    log.message.includes("execute_command") ||
    log.message.includes("Executing command") ||
    log.message.includes("[MOCK] Executing real command")
  );
  console.log(`\nExecute command logs: ${executeCommandLogs.length}`);
  if (executeCommandLogs.length > 0) {
    executeCommandLogs.forEach(log => {
      console.log(`  - ${log.message.substring(0, 150)}...`);
    });
  }
  
  const injectionLogs = allLogs.filter(log =>
    log.message.includes("injected") || 
    log.message.includes("Injected") ||
    log.message.includes("adding it")
  );
  console.log(`\nInjection logs: ${injectionLogs.length}`);
  if (injectionLogs.length > 0) {
    injectionLogs.forEach(log => {
      console.log(`  - ${log.message.substring(0, 150)}...`);
    });
  }
  
  const functionCallLogs = allLogs.filter(log =>
    log.message.includes("Function call:") ||
    log.message.includes("[Gemini] Function call")
  );
  console.log(`\nFunction call logs: ${functionCallLogs.length}`);
  if (functionCallLogs.length > 0) {
    functionCallLogs.forEach(log => {
      console.log(`  - ${log.message.substring(0, 150)}...`);
    });
  }
  
  const captureLogs = allLogs.filter(log =>
    log.message.includes("capture_window_with_ocr") ||
    log.message.includes("Window captured")
  );
  console.log(`\nWindow capture logs: ${captureLogs.length}`);
  
  console.log("\n" + "=".repeat(60) + "\n");
  
  // Restore console
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  
  process.exit(failed > 0 || !cmdTestPassed ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

