// TalentScreen AI — Access Control
const AUTH = {
  BETA_CODE: 'TALENT2026',
  SESSION_KEY: 'ts_ai_auth',
  SESSION_DURATION: 24 * 60 * 60 * 1000, // 24 hours

  isAuthenticated() {
    try {
      const session = JSON.parse(localStorage.getItem(this.SESSION_KEY) || '{}');
      if (!session.token || !session.expires) return false;
      if (Date.now() > session.expires) {
        this.logout();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },

  login(code) {
    if (code.trim().toUpperCase() === this.BETA_CODE) {
      const session = {
        token: btoa(Date.now() + ':' + Math.random()),
        expires: Date.now() + this.SESSION_DURATION,
        code: code.trim().toUpperCase()
      };
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
      return true;
    }
    return false;
  },

  logout() {
    localStorage.removeItem(this.SESSION_KEY);
    window.location.href = 'index.html';
  },

  guard() {
    if (!this.isAuthenticated()) {
      window.location.href = 'index.html';
    }
  }
};
