from flask import session, request, jsonify
import secrets, logging
from functools import wraps
from datetime import datetime

logger = logging.getLogger(__name__)

# CSRF Protection
def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return session['csrf_token']

def validate_csrf_token():
    token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
    return token and token == session.get('csrf_token')

def csrf_required(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if request.method in ['POST', 'PATCH', 'DELETE', 'PUT']:
            if request.method == 'OPTIONS':
                return f(*args, **kwargs)
            if not validate_csrf_token():
                logger.warning(f"CSRF validation failed for {request.endpoint}")
                return jsonify({'error': 'Invalid CSRF token'}), 403
        return f(*args, **kwargs)
    return wrapped

# Rate Limiting
rate_limit_store = {}

def rate_limit(max_requests=10, window=60):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            key = f"{request.remote_addr}:{f.__name__}"
            now = datetime.now().timestamp()
            
            if key in rate_limit_store:
                rate_limit_store[key] = [t for t in rate_limit_store[key] if now - t < window]
            else:
                rate_limit_store[key] = []
            
            if len(rate_limit_store[key]) >= max_requests:
                logger.warning(f"Rate limit exceeded for {key}")
                return jsonify({'error': 'Rate limit exceeded. Try again later.'}), 429
            
            rate_limit_store[key].append(now)
            return f(*args, **kwargs)
        return wrapped
    return decorator

# Security Headers
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://api.sambanova.ai"
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS, PUT'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token, Authorization'
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    return response
