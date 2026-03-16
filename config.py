import os
from dotenv import load_dotenv #type:ignore


# Load environment variables from .env file
load_dotenv()

# API Keys from environment variables
api_key = os.getenv('SAMBANOVA_API_KEY')
news_api_key = os.getenv('NEWS_API_KEY')

# Validate that keys are loaded
if not api_key or not news_api_key:
    raise ValueError("API keys not found. Please check your .env file")
