from flask import Flask
from pathlib import Path
import os, logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Validate environment
def validate_environment():
    required_vars = ['SAMBANOVA_API_KEY', 'SECRET_KEY', 'DB_PASSWORD']
    missing = [var for var in required_vars if not os.environ.get(var)]
    if missing:
        logger.error(f"Missing required environment variables: {', '.join(missing)}")
        print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
        print("Please set them in your .env file or environment.")
        import sys
        sys.exit(1)
    logger.info("Environment variables validated")

# Load .env
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip())

validate_environment()

def create_app():
    app = Flask(__name__, 
                template_folder='../templates',
                static_folder='../static')
    
    app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24).hex())
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SECURE'] = os.environ.get('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PREFERRED_URL_SCHEME'] = 'https' if app.config['SESSION_COOKIE_SECURE'] else 'http'
    app.config['PERMANENT_SESSION_LIFETIME'] = 2592000
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
    
    # Register blueprints
    from app.routes import auth, chats, tasks, pages
    app.register_blueprint(auth.bp)
    app.register_blueprint(chats.bp)
    app.register_blueprint(tasks.bp)
    app.register_blueprint(pages.bp)
    
    # Security headers
    from app.utils.security import set_security_headers
    app.after_request(set_security_headers)
    
    # Error handlers
    @app.errorhandler(404)
    def not_found(e):
        from flask import render_template
        return render_template('404.html'), 404
    
    @app.errorhandler(413)
    def request_too_large(e):
        from flask import jsonify
        logger.warning(f"Request too large")
        return jsonify({'error': 'Request too large. Maximum size is 16MB.'}), 413
    
    @app.errorhandler(500)
    def internal_error(e):
        from flask import jsonify
        logger.error(f"Internal error: {e}")
        return jsonify({'error': 'Internal server error. Please try again later.'}), 500
    
    return app
