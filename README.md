# Nexa AI

AI-powered desktop assistant with voice control and system management capabilities.

## Features

- **AI Chat** - Conversational AI using DeepSeek-V3.1 via SambaNova API
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
