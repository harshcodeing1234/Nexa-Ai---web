#!/usr/bin/env python3
"""
Nexa AI - Main Entry Point
Run with: python run.py (development) or gunicorn run:app (production)
"""

from app import create_app
from app.models.database import init_db
import logging

logger = logging.getLogger(__name__)

# Initialize database on import
init_db()

# Create Flask app
app = create_app()

if __name__ == "__main__":
    logger.info("Starting Nexa AI application in DEVELOPMENT mode")
    logger.warning("For production, use: gunicorn -w 2 -b 0.0.0.0:8080 run:app")
    
    try:
        import os
        port = int(os.environ.get("PORT", 8080))
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        logger.critical(f"Application failed to start: {str(e)}")
        raise
