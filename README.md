# AI Teacher

An interactive AI teaching assistant built with Tauri, React, and Google Gemini. The AI can see your screen in real-time and guide you through learning tasks proactively.

## Features

- **Real-time Screen Capture**: Continuously captures your screen to provide context-aware guidance
- **Proactive Teaching**: Automatically detects when you complete tasks and continues with next steps
- **Gemini Vision Integration**: Uses Google Gemini's vision capabilities to analyze your screen
- **Chat Interface**: Beautiful, modern chat UI with markdown support
- **Conversation Persistence**: All conversations are saved locally
- **Customizable Settings**: Adjust capture interval, theme, and more

## Prerequisites

- Node.js (v18 or higher)
- Rust (latest stable)
- A Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your Gemini API key:
   - The app will prompt you to enter your API key on first launch
   - Or you can set it in Settings

3. Run in development mode:
```bash
npm run tauri dev
```

4. Build for production:
```bash
npm run tauri build
```

## Project Structure

```
ai-teacher/
├── src/                    # Frontend React code
│   ├── components/        # React components
│   ├── hooks/            # Custom React hooks
│   ├── services/         # API and storage services
│   └── types/            # TypeScript type definitions
├── src-tauri/            # Tauri backend (Rust)
│   ├── src/
│   │   ├── commands.rs   # Tauri command handlers
│   │   ├── screen_capture.rs  # Screen capture logic
│   │   └── process_monitor.rs # Process monitoring
│   └── Cargo.toml        # Rust dependencies
└── package.json          # Node.js dependencies
```

## Usage

1. Launch the app and enter your Gemini API key in Settings
2. Start a conversation by asking the AI to help you learn something
3. The AI will capture your screen and guide you step-by-step
4. The AI automatically detects when you complete actions and continues guidance

## Configuration

- **Capture Interval**: Adjust how often screenshots are taken (1-10 seconds)
- **Theme**: Choose between light and dark themes
- **Conversations**: Manage, export, or delete saved conversations

## Development

The app uses:
- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri (Rust)
- **AI**: Google Gemini API (Vision + Chat)
- **Storage**: Tauri Store plugin

## Notes

- Screen capture requires appropriate permissions on your operating system
- The app continuously monitors your screen - ensure you're comfortable with this
- API usage will count towards your Gemini API quota

## License

**PROPRIETARY SOFTWARE** - All Rights Reserved.

This project is provided solely for portfolio demonstration and skills showcase purposes. 
No reproduction, use, modification, or distribution is permitted. See [LICENSE](LICENSE) for full terms.

