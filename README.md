# Nexa AI — Full-Stack AI Chat Platform

A beautiful, feature-rich AI assistant platform built with Python Flask + MySQL.

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
pip install flask werkzeug openai mysql-connector-python bleach PyPDF2
```

### 2. Setup MySQL Database
```bash
# Login to MySQL
mysql -u root -p

# Create database
CREATE DATABASE nexa;

# The tables will be created automatically when you run the app
```

### 3. Configure Environment Variables
Copy the example environment file and add your keys:
```bash
cp .env.example .env
```

Edit `.env` and set:
- `SAMBANOVA_API_KEY` - Your SambaNova API key
- `SECRET_KEY` - Generate with: `python -c "import os; print(os.urandom(24).hex())"`
- `SESSION_COOKIE_SECURE` - Set to `True` in production with HTTPS

**IMPORTANT**: Never commit your `.env` file to version control!

### 4. Run
```bash
python run.py
```

Visit: **http://localhost:8080**

## Database Configuration

The app uses MySQL with the following connection:
- Host: localhost
- User: root
- Password: welcome@123
- Database: nexa

To change these settings, edit the `get_db()` function in `app.py`.

## Production Deployment

### Quick Start (100 users)
```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables in .env
SESSION_COOKIE_SECURE=True
DB_PASSWORD=your_password

# Run with gunicorn
./start.sh
# OR
gunicorn -w 2 -b 0.0.0.0:8080 run:app
```

### Security Checklist
- [ ] Set `SESSION_COOKIE_SECURE=True` in `.env`
- [ ] Use HTTPS (Let's Encrypt, Cloudflare, etc.)
- [ ] Set strong `SECRET_KEY` (32+ random characters)
- [ ] Configure firewall rules
- [ ] Set up log monitoring
- [ ] Regular database backups
- [ ] Keep dependencies updated
- [ ] Change MySQL root password

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
├── run.py              # Application entry point
├── app/
│   ├── __init__.py     # App factory
│   ├── routes/
│   │   ├── auth.py     # Authentication routes
│   │   ├── chats.py    # Chat & messaging routes
│   │   ├── tasks.py    # Tasks & diary routes
│   │   └── pages.py    # Page rendering routes
│   ├── models/
│   │   └── database.py # Database connection & schema
│   ├── services/
│   │   ├── ai_service.py      # AI response generation
│   │   └── search_service.py  # Web search & Wikipedia
│   └── utils/
│       ├── security.py    # CSRF, rate limiting, headers
│       └── validation.py  # Input validation & sanitization
├── templates/
│   ├── index.html      # Landing page
│   ├── auth.html       # Login/Signup
│   ├── chat.html       # Main chat interface
│   ├── splash.html     # Loading screen
│   └── 404.html        # Error page
├── static/
│   ├── css/chat.css    # Chat styles
│   ├── js/chat.js      # Chat logic
│   ├── sw.js           # Service worker
│   ├── favicon.svg     # App icon
│   └── manifest.json   # PWA manifest
├── app_old.py          # Original monolithic file (backup)
└── .env                # Environment variables
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
- **Backend**: Python Flask 3.0+ + MySQL 8.0+
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

### MySQL connection error
```bash
# Check MySQL is running
sudo systemctl status mysql

# Login and verify database exists
mysql -u root -p
SHOW DATABASES;
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
