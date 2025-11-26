# AI Teacher

> **PROPRIETARY SOFTWARE - PORTFOLIO DEMONSTRATION ONLY**
> 
> This repository is provided exclusively to showcase technical skills and expertise.
> **No reproduction, use, modification, or distribution is permitted.**
> This is NOT open source. See [LICENSE](LICENSE) for full legal terms.

---

An interactive AI teaching assistant built with Tauri, React, and Google Gemini. The AI can see your screen in real-time and guide you through learning tasks proactively.

## About This Project

This project demonstrates proficiency in:

- **Desktop Application Development** with Tauri 2.0 (Rust backend + web frontend)
- **Modern React** with TypeScript, hooks, and component architecture
- **AI/LLM Integration** with Google Gemini Vision API for multimodal interactions
- **Systems Programming** in Rust for native screen capture and OCR
- **Real-time Processing** with streaming responses and live screen analysis
- **Security-Conscious Design** with command policy enforcement and approval workflows

## Technical Highlights

### Features Demonstrated

- Real-time screen capture with OCR text extraction
- Streaming AI responses with Google Gemini Vision
- Context-aware conversation management with token optimization
- Command execution with policy-based approval system (auto/approval_required/blocked)
- Cross-platform desktop app architecture (Windows focus)
- Modern UI with dark/light themes and markdown rendering

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, TypeScript, Vite 5 |
| Backend | Tauri 2.0, Rust |
| AI | Google Gemini API (Vision + Chat) |
| Native | Windows PowerShell integration, OCR |

### Architecture

```
ai-teacher/
├── src/                    # React frontend
│   ├── components/         # UI components (Chat, Settings, Messages)
│   ├── hooks/              # Custom hooks (useChat, useScreenCapture)
│   ├── services/           # Core logic (Gemini API, context management)
│   └── types/              # TypeScript definitions
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands.rs     # Tauri IPC command handlers
│       ├── screen_capture.rs
│       └── process_monitor/
└── scripts/                # Integration tests
```

## License

**PROPRIETARY SOFTWARE** - Copyright (c) 2024-2025 Emilian Cristea. All Rights Reserved.

This repository exists solely for the purpose of demonstrating technical skills and expertise to potential employers, clients, or collaborators.

**YOU MAY NOT:**
- Clone, fork, or reproduce this repository
- Use, execute, or deploy this software
- Modify or create derivative works
- Distribute or share this code

Viewing the source code for evaluation purposes only is permitted.

See [LICENSE](LICENSE) for complete legal terms.

---

*For inquiries about this project or licensing, please contact the author directly.*

