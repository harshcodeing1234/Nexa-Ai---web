# Nexa AI — Full-Stack AI Chat Platform

A beautiful, feature-rich AI assistant platform built with Python Flask + SQLite.

## Features
- **5 AI Models**: Nexa Pro, Flash, Vision, Code, Research
- **Voice Input** (Web Speech API) — auto-sends on speech
- **Voice Output** — female TTS reads AI responses
- **Task Manager** in sidebar
- **Chat History** with save, pin, rename, delete, share
- **Quick Commands** for fast prompts
- **Temporary Chats** (not saved)
- **Login/Signup** via email or phone
- **Guest Mode** — use without an account
- **Responsive** — works on mobile
- **Per-message actions**: copy, like, dislike, share, regenerate, speak
- **Edit user messages** in-chat
- **Offline Support** — PWA with service worker
- **Web Search Integration** — real-time search results

## Security Features
- ✅ CSRF Protection on all state-changing endpoints
- ✅ Content Security Policy headers
- ✅ XSS Prevention with HTML sanitization
- ✅ Strong password requirements (8+ chars, uppercase, lowercase, number)
- ✅ Database-backed rate limiting
- ✅ Secure session management
- ✅ Input validation and sanitization
- ✅ Request size limits (16MB max)
- ✅ Comprehensive error logging

## Setup

### 1. Install Requirements
```bash
pip install flask werkzeug openai
```

### 2. Configure Environment Variables
Copy the example environment file and add your keys:
```bash
cp .env.example .env
```

Edit `.env` and set:
- `SAMBANOVA_API_KEY` - Your SambaNova API key
- `SECRET_KEY` - Generate with: `python -c "import os; print(os.urandom(24).hex())"`
- `SESSION_COOKIE_SECURE` - Set to `True` in production with HTTPS

**IMPORTANT**: Never commit your `.env` file to version control!

### 3. Run
```bash
python app.py
# OR
bash run.sh
```

Visit: **http://localhost:5000**

## Production Deployment

### Security Checklist
- [ ] Set `SESSION_COOKIE_SECURE=True` in `.env`
- [ ] Use HTTPS (Let's Encrypt, Cloudflare, etc.)
- [ ] Set strong `SECRET_KEY` (32+ random characters)
- [ ] Configure firewall rules
- [ ] Set up log monitoring
- [ ] Regular database backups
- [ ] Keep dependencies updated

### Recommended Setup
```bash
# Use gunicorn for production
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app

# Or use nginx as reverse proxy
# See nginx.conf.example for configuration
```

## Project Structure
```
nexa_ai/
├── app.py              # Flask backend + SQLite API
├── nexa_ai.db          # SQLite database (auto-created)
├── uploads/            # User profile photos
├── templates/
│   ├── index.html      # Landing page
│   ├── auth.html       # Login/Signup
│   ├── chat.html       # Main chat interface
│   ├── splash.html     # Loading screen
│   └── 404.html        # Error page
├── static/
│   ├── css/chat.css    # Chat styles
│   ├── js/chat.js      # Chat logic (voice, tasks, etc.)
│   ├── sw.js           # Service worker for offline support
│   ├── favicon.svg     # App icon
│   └── manifest.json   # PWA manifest
└── run.sh              # Startup script
```

## Pages
- `/` — Landing page (Home, About, Features, Contact)
- `/auth` — Login / Signup / Guest mode
- `/chat` — Main AI chat interface

## API Endpoints

### Authentication
- `POST /api/signup` - Create new account
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/me` - Get current user info
- `PATCH /api/profile` - Update profile

### Chats
- `GET /api/chats` - List all chats
- `POST /api/chats` - Create new chat
- `GET /api/chats/<id>` - Get chat with messages
- `PATCH /api/chats/<id>` - Update chat (title, pin, save)
- `DELETE /api/chats/<id>` - Delete chat
- `POST /api/chats/<id>/messages` - Send message
- `POST /api/chats/<id>/regenerate/<msg_id>` - Regenerate response
- `GET /api/chats/<id>/export?format=json|txt` - Export chat

### Tasks
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/<id>` - Update task
- `DELETE /api/tasks/<id>` - Delete task

### Utility
- `GET /api/csrf-token` - Get CSRF token
- `GET /api/stats` - Get user statistics

## Tech Stack
- **Backend**: Python Flask 3.0+ + SQLite3
- **Auth**: Werkzeug password hashing + CSRF tokens
- **AI**: SambaNova API (DeepSeek, Llama, Qwen models)
- **Voice**: Web Speech API (browser-native)
- **TTS**: SpeechSynthesis API (browser-native, female voice)
- **Fonts**: System fonts (-apple-system, BlinkMacSystemFont)
- **PWA**: Service Worker for offline support

## Performance Optimizations
- Database indexes on frequently queried columns
- Rate limiting to prevent abuse
- Static asset caching via service worker
- Efficient query patterns with proper JOINs
- Connection management with context managers

## Browser Support
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### Database locked error
```bash
# Close all connections and restart
rm nexa_ai.db
python app.py
```

### CSRF token errors
```bash
# Clear browser cookies and refresh
# Or fetch new token: GET /api/csrf-token
```

### Rate limit exceeded
Wait 5 minutes for auth endpoints, 1 minute for message endpoints.

## Contributing
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

## License
MIT License - feel free to use for personal or commercial projects.

## Support
For issues, questions, or feature requests, please open an issue on GitHub.

---

***Built by [Harsh](https://www.linkedin.com/in/harsh-bca/)***
