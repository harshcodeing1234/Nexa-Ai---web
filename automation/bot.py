try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, ContextTypes, filters, ConversationHandler
    import requests, os
    from datetime import datetime
    import xml.etree.ElementTree as ET

    TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '8793297421:AAFTejLJVbnq0qp6fJ9FFizlgXJmo3-hmdw')
    NEWSAPI_KEY = os.environ.get('NEWSAPI_KEY', '0bbfffcbbadb4db3a37f8065c607d376')
    ADZUNA_APP_ID = os.environ.get('ADZUNA_APP_ID', '7154969e')
    ADZUNA_APP_KEY = os.environ.get('ADZUNA_APP_KEY', '40b8da0d2d57b8a96d7c56cb11630633')
    ASK_NAME, SHOW_LEARNING = 0, 1

    def get_motivation():
        quotes = [
            "Mehnat karo, safalta zaroor milegi!",
            "Haar mat mano, bas ek kadam aur chalo!",
            "Sapne wo nahi jo neend mein aaye, sapne wo hain jo neend uda de!",
            "Aaj ka din kal se behtar banao!",
            "Consistency hi success ki key hai!"
        ]
        return quotes[datetime.now().second % len(quotes)]

    def get_news():
        try:
            url = f"https://newsapi.org/v2/top-headlines?country=in&pageSize=5&apiKey={NEWSAPI_KEY}"
            res = requests.get(url, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
            data = res.json()
            
            if data.get('status') == 'ok' and data.get('articles'):
                news = ""
                for i, a in enumerate(data['articles'][:5], 1):
                    news += f"{i}. {a.get('title', 'No title')}\n"
                    if a.get('url'):
                        news += f"   [Read]({a['url']})\n\n"
                return news if news else "No news available"
            
            url2 = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en"
            res2 = requests.get(url2, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
            root = ET.fromstring(res2.content)
            news = ""
            for i, item in enumerate(root.findall('.//item')[:5], 1):
                title = item.find('title')
                link = item.find('link')
                if title is not None and link is not None:
                    news += f"{i}. {title.text}\n   [Read]({link.text})\n\n"
            return news if news else "News unavailable"
        except Exception as e:
            return f"News fetch failed: {str(e)[:50]}"

    def get_research_papers():
        try:
            url = "http://export.arxiv.org/api/query?search_query=ai&start=0&max_results=5"
            res = requests.get(url, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
            root = ET.fromstring(res.content)
            papers = ""
            for i, entry in enumerate(root.findall('{http://www.w3.org/2005/Atom}entry'), 1):
                title = entry.find('{http://www.w3.org/2005/Atom}title')
                link = entry.find('{http://www.w3.org/2005/Atom}id')
                if title is not None and link is not None:
                    papers += f"{i}. {title.text.strip().replace('\n', ' ')}\n   [Read]({link.text.strip()})\n\n"
            return papers if papers else "Papers unavailable"
        except Exception as e:
            return f"Papers fetch failed: {str(e)[:50]}"

    def get_jobs():
        try:
            url = "https://api.adzuna.com/v1/api/jobs/in/search/1"
            params = {
                "app_id": ADZUNA_APP_ID,
                "app_key": ADZUNA_APP_KEY,
                "what": "software engineer",
                "results_per_page": 10
            }
            res = requests.get(url, params=params, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
            data = res.json()
            total = data.get('count', 0)
            jobs = f"📊 Total Jobs: {total:,}+\n\n"
            for i, job in enumerate(data.get('results', [])[:5], 1):
                jobs += f"{i}. {job.get('title', 'N/A')}\n"
                company = job.get('company', {})
                if isinstance(company, dict):
                    jobs += f"   🏢 {company.get('display_name', 'N/A')}\n"
                location = job.get('location', {})
                if isinstance(location, dict):
                    jobs += f"   📍 {location.get('display_name', 'N/A')}\n"
                if job.get('redirect_url'):
                    jobs += f"   [Apply]({job['redirect_url']})\n\n"
            return jobs if len(data.get('results', [])) > 0 else "No jobs found"
        except Exception as e:
            return f"Jobs fetch failed: {str(e)[:50]}"

    def get_stock_market():
        try:
            url = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d"
            headers = {'User-Agent': 'Mozilla/5.0'}
            res = requests.get(url, headers=headers, timeout=15)
            data = res.json()
            result = data['chart']['result'][0]
            meta = result['meta']
            price = meta['regularMarketPrice']
            prev = meta['previousClose']
            change = price - prev
            percent = (change / prev) * 100
            emoji = "📈" if change > 0 else "📉"
            return f"{emoji} NIFTY 50: ₹{price:.2f} ({'+' if change > 0 else ''}{change:.2f}, {'+' if percent > 0 else ''}{percent:.2f}%)"
        except Exception as e:
            return f"📊 Market data unavailable: {str(e)[:30]}"

    learning_resources = {
        "Python": "https://youtube.com/watch?v=_uQrJ0TkZlc",
        "AI/ML": "https://youtube.com/watch?v=aircAruvnKk",
        "Web Dev": "https://youtube.com/watch?v=pQN-pnXPaVg",
        "Data Science": "https://youtube.com/watch?v=ua-CiDNNj30"
    }

    async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text("Hello, What's your name?")
        return ASK_NAME

    async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
        name = update.message.text
        hour = datetime.now().hour
        greeting = "Good morning" if hour < 12 else "Hello" if hour < 18 else "Good evening"
        
        try:
            await update.message.reply_text(f"{greeting}, {name}! 🙏\n\n{get_motivation()}")
            await update.message.reply_text(get_stock_market())
            await update.message.reply_text(f"📰 Top 5 News (India):\n\n{get_news()}", parse_mode='Markdown')
            await update.message.reply_text(f"📚 Latest AI Research:\n\n{get_research_papers()}", parse_mode='Markdown')
            await update.message.reply_text(f"💼 Job Market:\n\n{get_jobs()}", parse_mode='Markdown')
            
            keyboard = [[InlineKeyboardButton(k, callback_data=k)] for k in learning_resources.keys()]
            await update.message.reply_text("📖 What do you want to learn today?", reply_markup=InlineKeyboardMarkup(keyboard))
        except Exception as e:
            await update.message.reply_text(f"Error: {str(e)[:100]}")
        
        return SHOW_LEARNING

    async def show_learning(update: Update, context: ContextTypes.DEFAULT_TYPE):
        query = update.callback_query
        await query.answer()
        link = learning_resources.get(query.data, "")
        if link:
            await query.message.reply_text(f"📖 {query.data} Tutorial:\n{link}\n\n🔥 Keep learning!")
        return ConversationHandler.END

    if __name__ == "__main__":
        app = ApplicationBuilder().token(TOKEN).build()
        conv_handler = ConversationHandler(
            entry_points=[CommandHandler("start", start)],
            states={
                ASK_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
                SHOW_LEARNING: [CallbackQueryHandler(show_learning)]
            },
            fallbacks=[]
        )
        app.add_handler(conv_handler)
        print("Bot started...")
        app.run_polling()
except Exception as e:
    print(e)