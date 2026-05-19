from openai import OpenAI
import os, logging, base64, tempfile
import PyPDF2

logger = logging.getLogger(__name__)

api_key = os.environ.get('SAMBANOVA_API_KEY', '')
client = OpenAI(api_key=api_key, base_url="https://api.sambanova.ai/v1") if api_key else None

def generate_ai_response(user_message, model, history):
    if not client:
        logger.error("AI client not configured")
        return f"I'm Nexa AI ({model}). The AI service is not configured. Please set the SAMBANOVA_API_KEY environment variable."
    
    try:
        personas = {
            'nexa-pro': 'You are Nexa Pro, an advanced AI assistant with deep reasoning capabilities. Be thorough, insightful and well-structured. Use markdown formatting where helpful.',
            'nexa-flash': 'You are Nexa Flash, a fast AI assistant. Be concise, direct and clear. Avoid unnecessary verbosity.',
            'nexa-vision': 'You are Nexa Vision, specializing in creative and visual thinking. Be imaginative, descriptive and inspire creativity.',
            'nexa-code': 'You are Nexa Code, an expert programmer. Provide clean, efficient, well-commented code with explanations. Always specify the language in code blocks.',
            'nexa-research': 'You are Nexa Research, specialized in deep analysis. Provide structured, comprehensive responses with clear headings and bullet points.',
        }
        
        model_mapping = {
            'nexa-pro':      'DeepSeek-V3.1',
            'nexa-flash':    'Meta-Llama-3.3-70B-Instruct',
            'nexa-vision':   'gemma-3-12b-it',
            'nexa-code':     'DeepSeek-V3.2',
            'nexa-research': 'gpt-oss-120b'
        }
        
        system_msg = personas.get(model, personas['nexa-pro'])
        backend_model = model_mapping.get(model, 'DeepSeek-V3.1')
        messages = [{"role": "system", "content": system_msg}] + history[-10:]
        
        response = client.chat.completions.create(
            model=backend_model,
            messages=messages,
            temperature=0.7,
            max_tokens=1500
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        error_str = str(e)
        logger.error(f"AI Response Error: {error_str}")
        if "401" in error_str or "authentication" in error_str.lower():
            return f"I'm Nexa AI ({model}). Authentication failed. Please check your API key configuration."
        elif "429" in error_str or "rate" in error_str.lower():
            return f"I'm Nexa AI ({model}). The AI service is currently rate limited. Please try again in a moment."
        else:
            return f"I'm Nexa AI ({model}). Error: {error_str[:100]}"

def analyze_file_content(file_path, filename):
    """Analyze file content and return description"""
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    
    # Image analysis - skip vision API
    if ext in ['png', 'jpg', 'jpeg', 'gif', 'webp']:
        return f"[IMAGE FILE: {filename}]\nImage uploaded successfully."
    
    # Text file analysis
    elif ext in ['txt', 'csv']:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(5000)
            return f"[TEXT FILE: {filename}]\n\nFile Content:\n{content[:4000]}"
        except:
            return f"[TEXT FILE: {filename}]"
    
    # PDF analysis
    elif ext == 'pdf':
        try:
            with open(file_path, 'rb') as f:
                pdf = PyPDF2.PdfReader(f)
                text = ""
                for page in pdf.pages[:5]:
                    text += page.extract_text()
            return f"[PDF FILE: {filename}]\n\nExtracted Text:\n{text[:4000]}"
        except:
            return f"[PDF FILE: {filename}]\nPDF file uploaded."
    
    # Other files
    else:
        return f"[FILE: {filename}]\nFile type: {ext.upper()}\nNote: This file type cannot be analyzed."
