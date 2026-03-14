// Contact page functionality
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('contactForm');
    const cards = document.querySelectorAll('.info-card');
    
    // Animate cards on load
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            card.style.transition = 'all 0.5s';
            
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'scale(1)';
            }, 50);
        }, index * 100);
    });
    
    // Form submission
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const btn = form.querySelector('.submit-btn');
        const originalText = btn.textContent;
        
        btn.textContent = 'Sending...';
        btn.disabled = true;
        
        setTimeout(() => {
            btn.textContent = 'Message Sent! ✓';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            
            setTimeout(() => {
                form.reset();
                btn.textContent = originalText;
                btn.disabled = false;
                btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }, 2000);
        }, 1500);
    });
});
