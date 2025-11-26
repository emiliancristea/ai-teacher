# Quick Start Guide

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Get a Gemini API Key:**
   - Visit https://makersuite.google.com/app/apikey
   - Create a new API key
   - Copy the key

3. **Run the app:**
   ```bash
   npm run tauri dev
   ```

4. **On first launch:**
   - Enter your Gemini API key in Settings
   - The app will start capturing your screen automatically

## Usage

1. **Start a conversation:** Ask the AI to help you learn something (e.g., "Help me learn Python")
2. **Follow instructions:** The AI will guide you step-by-step
3. **Automatic continuation:** The AI detects when you complete actions and continues automatically
4. **View history:** All conversations are saved and can be accessed from Settings

## Features

- **Real-time screen capture:** Captures your entire screen continuously
- **Proactive guidance:** Automatically continues when tasks are completed
- **Vision analysis:** Uses Gemini Vision to understand what's on your screen
- **Chat persistence:** All conversations saved locally
- **Customizable:** Adjust capture interval, theme, and more

## Troubleshooting

- **Screen capture not working:** Ensure the app has screen recording permissions
- **API errors:** Check your Gemini API key and quota
- **Performance issues:** Increase capture interval in Settings (default: 3 seconds)

## Building for Production

```bash
npm run tauri build
```

The built app will be in `src-tauri/target/release/`

