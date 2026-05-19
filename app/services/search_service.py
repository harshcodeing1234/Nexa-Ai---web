import urllib.request, urllib.parse, json, re, os, logging
from html import unescape

logger = logging.getLogger(__name__)

def perform_web_search(query):
    try:
        results = []
        
        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://www.google.com/search?q={encoded_query}&num=5&hl=en"
            
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            
            with urllib.request.urlopen(req, timeout=8) as response:
                html = response.read().decode('utf-8', errors='ignore')
            
            featured = re.findall(r'<div class="[^"]*hgKElc[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
            if featured:
                clean = re.sub(r'<[^>]+>', '', featured[0])
                clean = unescape(re.sub(r'\s+', ' ', clean).strip())
                if clean and len(clean) > 10:
                    results.append(f"Featured Answer: {clean}")
            
            snippets = re.findall(r'<div class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
            for snippet in snippets[:4]:
                clean = re.sub(r'<[^>]+>', '', snippet)
                clean = unescape(re.sub(r'\s+', ' ', clean).strip())
                if clean and len(clean) > 30 and clean not in str(results):
                    results.append(clean)
        except Exception as e:
            logger.error(f"Google search failed: {e}")
        
        if results:
            formatted = "\n".join([f"• {r}" for r in results[:5]])
            return f"[Web Search Results for: {query}]\n{formatted}"
        
        return None
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return None

def fetch_wikipedia_summary(query):
    try:
        encoded_query = urllib.parse.quote(query.replace(' ', '_'))
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded_query}"
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read())
        except:
            search_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={urllib.parse.quote(query)}&limit=5&format=json"
            req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                search_data = json.loads(response.read())
            
            if search_data and len(search_data) > 3 and search_data[1]:
                page_title = search_data[1][0].replace(' ', '_')
                url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{page_title}"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read())
            else:
                return f"Wikipedia page not found for '{query}'. Let me help you with information about this topic instead."
        
        if data.get('type') == 'standard':
            title = data.get('title', query)
            extract = data.get('extract', '')
            thumbnail = data.get('thumbnail', {}).get('source', '')
            page_url = data.get('content_urls', {}).get('desktop', {}).get('page', '')
            
            html = "<div style='padding:20px;background:var(--surface2);border-radius:12px;'>"
            html += f"<h2 style='color:#63b3ed;margin-bottom:15px;font-size:24px;'>📚 {title}</h2>"
            
            if thumbnail:
                html += f"<img src='{thumbnail}' style='max-width:300px;border-radius:8px;margin-bottom:15px;' /><br>"
            
            html += f"<div style='font-size:15px;line-height:1.8;color:var(--text);margin-bottom:20px;'>{extract}</div>"
            
            if page_url:
                html += f"<a href='{page_url}' target='_blank' style='display:inline-flex;align-items:center;gap:5px;padding:8px 16px;background:#63b3ed;color:#000;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;'>🔗 Read full article</a>"
            
            html += "</div>"
            return html
        else:
            return f"Wikipedia page for '{query}' exists but couldn't be formatted. Let me provide information about this topic instead."
    except Exception as e:
        logger.error(f"Wikipedia fetch error: {e}")
        return f"Couldn't fetch Wikipedia page for '{query}'. Let me help you with information about this topic instead."

def fetch_india_news():
    api_key = os.environ.get('NEWSAPI_KEY', '')
    if not api_key or api_key == 'your_newsapi_key_here':
        logger.warning("NewsAPI key not configured")
        return "NewsAPI key not configured. Get your free key from https://newsapi.org"
    
    try:
        urls = [
            f"https://newsapi.org/v2/top-headlines?country=in&pageSize=20&apiKey={api_key}",
            f"https://newsapi.org/v2/everything?q=India&sortBy=publishedAt&pageSize=20&language=en&apiKey={api_key}"
        ]
        
        articles = []
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as response:
                    data = json.loads(response.read())
                
                if data.get('status') == 'ok':
                    articles = data.get('articles', [])
                    if articles:
                        break
            except Exception as e:
                logger.error(f"NewsAPI error: {e}")
                continue
        
        if not articles:
            return "No breaking news found. Try again later."
        
        news_text = "<div style='padding:20px;background:var(--surface2);border-radius:12px;'>"
        news_text += "<h2 style='color:#63b3ed;margin-bottom:20px;font-size:24px;'>🇮🇳 India Breaking News</h2>"
        
        for i, article in enumerate(articles[:20], 1):
            title = article.get('title', 'No title')
            description = article.get('description', '')
            source = article.get('source', {}).get('name', 'Unknown')
            url = article.get('url', '')
            published = article.get('publishedAt', '')[:10]
            
            news_text += f"<div style='margin-bottom:20px;padding:15px;background:var(--surface);border-left:3px solid #63b3ed;border-radius:8px;'>"
            news_text += f"<div style='font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;'>{i}. {title}</div>"
            
            if description:
                news_text += f"<div style='font-size:14px;color:var(--text2);margin-bottom:10px;line-height:1.6;'>{description}</div>"
            
            news_text += f"<div style='display:flex;align-items:center;gap:15px;font-size:13px;color:var(--muted);margin-bottom:8px;'>"
            news_text += f"<span>📰 {source}</span><span>📅 {published}</span></div>"
            
            if url:
                news_text += f"<a href='{url}' target='_blank' style='display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:#63b3ed;color:#000;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;'>🔗 Read more</a>"
            
            news_text += "</div>"
        
        news_text += "</div>"
        return news_text
    except Exception as e:
        logger.error(f"NewsAPI fetch error: {e}")
        return f"Failed to fetch news: {str(e)}"
