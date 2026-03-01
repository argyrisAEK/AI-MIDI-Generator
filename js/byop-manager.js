export class BYOPManager {
  constructor(ui) {
    this.ui = ui;
    this.userKey = localStorage.getItem('pollinations_user_key');
    this.checkForAuthRedirect();
    this.updateUI();
  }

  // Έλεγχος αν γυρνάμε από Pollinations auth
  checkForAuthRedirect() {
    const hash = window.location.hash;
    if (hash.includes('api_key=')) {
      const params = new URLSearchParams(hash.slice(1));
      const key = params.get('api_key');
      
      if (key) {
        this.userKey = key;
        localStorage.setItem('pollinations_user_key', key);
        localStorage.setItem('pollinations_key_set_at', Date.now());
        
        // Καθάρισε το URL για αισθητικούς λόγους
        history.replaceState({}, document.title, window.location.pathname);
        
        this.ui.showMessage('✓ Account connected successfully! You now have unlimited generations.', 'success');
        this.updateUI();
      }
    }
  }

  hasUserKey() {
    return !!this.userKey;
  }

  getKey() {
    return this.userKey;
  }

  // Redirect στο Pollinations auth
  connectAccount() {
    const redirectUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const authUrl = `https://enter.pollinations.ai/authorize?redirect_url=${redirectUrl}&permissions=profile,balance&models=openai,claude&expiry=30`;
    window.location.href = authUrl;
  }

  disconnect() {
    localStorage.removeItem('pollinations_user_key');
    localStorage.removeItem('pollinations_key_set_at');
    this.userKey = null;
    this.updateUI();
    this.ui.showMessage('Disconnected your account. You now have 5 free generations per day.', 'info');
  }

  updateUI() {
    const byopStatus = document.getElementById('byop-status');
    const connectBtn = document.getElementById('connect-byop-btn');

    if (this.userKey) {
      if (byopStatus) byopStatus.textContent = '✓ Connected (Unlimited)';
      if (byopStatus) byopStatus.className = 'byop-status connected';
      if (connectBtn) connectBtn.style.display = 'none';
    } else {
      if (byopStatus) byopStatus.textContent = 'Free: 5/day';
      if (byopStatus) byopStatus.className = 'byop-status free';
      if (connectBtn) connectBtn.style.display = 'inline-flex';
    }
  }
}
