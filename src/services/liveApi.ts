import type { Settings } from "../types";

const MODEL = "models/gemini-2.5-flash-native-audio-preview-09-2025";
const SEND_SAMPLE_RATE = 16000;
const RECEIVE_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 1024;

export interface LiveApiConfig {
  apiKey: string;
  voice?: string;
  responseModalities?: string[];
  mediaResolution?: string;
}

export class LiveApiService {
  private apiKey: string;
  private voice: string;
  private session: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private isConnected: boolean = false;

  constructor(config: LiveApiConfig) {
    this.apiKey = config.apiKey;
    this.voice = config.voice || "Zephyr";
  }

  async connect(): Promise<void> {
    try {
      // Initialize audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Get user media for microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SEND_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Create WebSocket connection to Gemini Live API
      // Note: The Live API uses a different endpoint structure
      // This is a placeholder - the actual implementation may require:
      // 1. Using the @google/genai SDK if it supports Live API
      // 2. Creating a Tauri command that runs Python code
      // 3. Using a different WebSocket endpoint format
      // 
      // Based on the Python code, the model is: "models/gemini-2.5-flash-native-audio-preview-09-2025"
      // API version: v1beta
      // 
      // For now, this is a structure that can be completed once the exact API endpoint is confirmed
      const wsUrl = `wss://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-preview-09-2025:streamGenerateContent?key=${this.apiKey}`;
      
      this.session = new WebSocket(wsUrl);
      
      this.session.onopen = () => {
        this.isConnected = true;
        this.sendConfig();
        this.startAudioCapture();
      };

      this.session.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.session.onerror = (error) => {
        console.error("Live API WebSocket error:", error);
      };

      this.session.onclose = () => {
        this.isConnected = false;
        this.cleanup();
      };
    } catch (error) {
      console.error("Failed to connect to Live API:", error);
      throw error;
    }
  }

  private sendConfig(): void {
    if (!this.session || this.session.readyState !== WebSocket.OPEN) return;

    const config = {
      setup: {
        model: MODEL,
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: this.voice,
              },
            },
          },
          media_resolution: "MEDIA_RESOLUTION_MEDIUM",
        },
      },
    };

    this.session.send(JSON.stringify(config));
  }

  private startAudioCapture(): void {
    if (!this.mediaStream || !this.audioContext) return;

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!this.isConnected || !this.session) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const pcmData = this.convertFloat32ToPCM16(inputData);

      // Send audio chunk
      const message = {
        input: {
          media_chunks: [
            {
              mime_type: "audio/pcm",
              data: this.arrayBufferToBase64(pcmData),
            },
          ],
        },
      };

      this.session.send(JSON.stringify(message));
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      if (data.output?.mediaChunks) {
        // Handle audio response
        data.output.mediaChunks.forEach((chunk: any) => {
          if (chunk.mimeType === "audio/pcm" && chunk.data) {
            this.playAudio(chunk.data);
          }
        });
      }

      if (data.output?.text) {
        // Handle text response if any
        console.log("Live API text:", data.output.text);
      }
    } catch (error) {
      console.error("Error handling Live API message:", error);
    }
  }

  private playAudio(base64Data: string): void {
    if (!this.audioContext) return;

    const audioData = this.base64ToArrayBuffer(base64Data);
    const sampleCount = audioData.byteLength / 2;
    const audioBuffer = this.audioContext.createBuffer(1, sampleCount, RECEIVE_SAMPLE_RATE);

    const channelData = audioBuffer.getChannelData(0);
    const pcm16Data = new Int16Array(audioData);
    
    for (let i = 0; i < pcm16Data.length; i++) {
      channelData[i] = pcm16Data[i] / 32768.0;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start();
  }

  private convertFloat32ToPCM16(float32Array: Float32Array): ArrayBuffer {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16.buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  disconnect(): void {
    this.isConnected = false;
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  isActive(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
let liveApiInstance: LiveApiService | null = null;

export function initializeLiveApi(settings: Settings): LiveApiService {
  if (!settings.geminiApiKey) {
    throw new Error("Gemini API key is required for Live API");
  }

  liveApiInstance = new LiveApiService({
    apiKey: settings.geminiApiKey,
    voice: settings.voice || "Zephyr",
  });

  return liveApiInstance;
}

export function getLiveApiInstance(): LiveApiService | null {
  return liveApiInstance;
}

export function disconnectLiveApi(): void {
  if (liveApiInstance) {
    liveApiInstance.disconnect();
    liveApiInstance = null;
  }
}

