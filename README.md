# Nexa AI

AI-powered desktop assistant with voice control and system management capabilities.

## Features

- **AI Chat** - Conversational AI with multiple model options via SambaNova API
- **Model Selector** - Switch between 5 AI models (click logo to change)
- **Voice Control** - Speech recognition and text-to-speech
- **System Info** - Time, battery, CPU, RAM monitoring
- **System Control** - Shutdown, restart, clean temp files
- **Task Manager** - Add, remove, and list tasks
- **Media Control** - Play YouTube videos
- **App Launcher** - Open apps and websites
- **Wikipedia Search** - Quick information lookup
- **News** - Top headlines via NewsAPI
- **Screenshots** - Capture screen
- **Chat History** - Save and load conversations

## Available AI Models

1. **DeepSeek-V3.2** - Complex reasoning, coding, technical questions
2. **Qwen3-235B** - Multilingual tasks, translation, diverse knowledge
3. **DeepSeek-R1-0528** - Research, analysis, detailed explanations
4. **Meta-Llama-3.1-8B-Instruct** - Quick responses, general chat, fast tasks
5. **DeepSeek-V3.1** - Balanced performance, general knowledge (default)

## Tech Stack

- **Backend**: Flask (Python)
- **Frontend**: HTML, CSS, JavaScript
- **AI**: OpenAI SDK with SambaNova API
- **APIs**: NewsAPI, Wikipedia, Official Joke API

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

Update `config.py` with your API keys:
- SambaNova API key
- NewsAPI key

## Usage

```bash
python app.py
```

Access at `http://localhost:10000`

## Commands

- "time" - Current time
- "battery" - Battery status
- "cpu" / "ram" - System usage
- "play [song]" - Play on YouTube
- "open [app/website]" - Launch apps/sites
- "wikipedia [topic]" - Search Wikipedia
- "news" - Top headlines
- "joke" - Random joke
- "add task [task]" - Add task
- "list tasks" - Show tasks
- "screenshot" - Capture screen
- "clean system" - Clear temp files
- "shutdown" / "restart" - System control
- "new chat" - Start fresh conversation
