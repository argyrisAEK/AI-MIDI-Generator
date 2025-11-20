import * as Tone from 'tone';

export class UIManager {
    constructor(app) {
        this.app = app;
        this.statusContainer = document.getElementById('status-container');
        this.activeTimeout = null;
    }
    
    bindKeyboardShortcuts() {
    }
    
    showTooltip(message, element, duration = 3000) {
        const tooltip = document.createElement('div');
        tooltip.textContent = message;
        Object.assign(tooltip.style, {
            position: 'absolute', backgroundColor: 'rgba(0, 0,0, 0.85)', color: 'white',
            padding: '8px 12px', borderRadius: '6px', fontSize: '14px',
            zIndex: '1000', pointerEvents: 'none',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
        });
        
        document.body.appendChild(tooltip);
        
        const rect = element.getBoundingClientRect();
        tooltip.style.top = `${rect.bottom + 8 + window.scrollY}px`;
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        
        setTimeout(() => {
            tooltip.style.transition = 'opacity 0.3s ease';
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.remove(), 300);
        }, duration);
    }
    
    showMessage(message, type = 'info') {
        if (this.activeTimeout) clearTimeout(this.activeTimeout);

        const messageDiv = document.createElement('div');
        messageDiv.className = `status-message ${type}-message`;
        
        if (type === 'loading') {
            const spinner = document.createElement('div');
            spinner.className = 'spinner';
            messageDiv.appendChild(spinner);
        }
        
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        messageDiv.appendChild(textSpan);
        
        // Enhanced animation approach
        messageDiv.style.cssText = 'opacity: 0; transform: translateY(-10px); transition: opacity 0.3s ease, transform 0.3s ease;';
        
        this.statusContainer.innerHTML = '';
        this.statusContainer.appendChild(messageDiv);

        // Use requestAnimationFrame for smooth animation
        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
            messageDiv.style.transform = 'translateY(0)';
        });

        if (type !== 'loading') {
            this.activeTimeout = setTimeout(() => {
                messageDiv.style.opacity = '0';
                messageDiv.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    if (messageDiv.parentNode) messageDiv.remove();
                }, 300);
            }, type === 'error' ? 8000 : (type === 'warning' ? 6000 : 5000));
        }
    }

    showLoading(message = 'Loading...') {
        this.showMessage(message, 'loading');
    }

    hideLoading() {
        const loadingMessage = this.statusContainer.querySelector('.loading-message');
        if (loadingMessage) loadingMessage.remove();
    }

    updateButtonStates(enabled) {
        document.getElementById('play').disabled = !enabled;
        document.getElementById('stop').disabled = !enabled;
        document.getElementById('download').disabled = !enabled;
    }

    dispose() {
        if (this.activeTimeout) clearTimeout(this.activeTimeout);
        if (this.statusContainer) this.statusContainer.innerHTML = '';
    }
}
