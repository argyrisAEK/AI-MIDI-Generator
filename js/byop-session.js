// ─────────────────────────────────────────────────────────────
// Pollinations Pay (BYOP) session helper
// Όλα τα δεδομένα συνεδρίας ζουν ΜΟΝΟ σε sessionStorage (ανά tab),
// όπως προτείνουν τα επίσημα Pollinations API docs. Ποτέ localStorage.
// ─────────────────────────────────────────────────────────────

const K = {
    key: 'byop_pollinations_key',
    exp: 'byop_token_expires_at',
    user: 'byop_user_info',
    verifier: 'byop_code_verifier',
    state: 'byop_oauth_state'
};

// Κλειδιά από παλιές εκδόσεις (localStorage / free tier) που πρέπει να καθαριστούν.
const LEGACY_LOCAL_KEYS = [
    'byop_pollinations_key', 'byop_token_expires_at', 'byop_user_info',
    'byop_code_verifier', 'byop_oauth_state',
    'free_generations_data', 'midi_user_id'
];

export function purgeLegacyByopStorage() {
    try { LEGACY_LOCAL_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
}

/** Επιστρέφει το sk_… key ή null. Αν έχει λήξει, καθαρίζει τη συνεδρία. */
export function getByopKey() {
    try {
        const key = sessionStorage.getItem(K.key);
        if (!key) return null;
        const expiresAt = parseInt(sessionStorage.getItem(K.exp) || '0', 10);
        if (expiresAt > 0 && Date.now() > expiresAt) {
            clearByopSession();
            return null;
        }
        return key;
    } catch {
        return null;
    }
}

export function setByopSession(accessToken, expiresInSeconds) {
    sessionStorage.setItem(K.key, accessToken);
    if (expiresInSeconds) {
        sessionStorage.setItem(K.exp, String(Date.now() + Number(expiresInSeconds) * 1000));
    } else {
        sessionStorage.removeItem(K.exp);
    }
}

export function setByopUser(info) {
    try { sessionStorage.setItem(K.user, JSON.stringify(info)); } catch { /* ignore */ }
}

export function getByopUser() {
    try { return JSON.parse(sessionStorage.getItem(K.user) || '{}'); } catch { return {}; }
}

export function clearByopSession() {
    try {
        sessionStorage.removeItem(K.key);
        sessionStorage.removeItem(K.exp);
        sessionStorage.removeItem(K.user);
    } catch { /* ignore */ }
}

// ── OAuth (PKCE) προσωρινά δεδομένα ──
export function saveOAuthState(codeVerifier, state) {
    sessionStorage.setItem(K.verifier, codeVerifier);
    sessionStorage.setItem(K.state, state);
}

export function readOAuthState() {
    try {
        return { codeVerifier: sessionStorage.getItem(K.verifier), state: sessionStorage.getItem(K.state) };
    } catch {
        return { codeVerifier: null, state: null };
    }
}

export function clearOAuthState() {
    try {
        sessionStorage.removeItem(K.verifier);
        sessionStorage.removeItem(K.state);
    } catch { /* ignore */ }
}

/** Σφάλμα που σημαίνει «δεν υπάρχει συνδεδεμένο Pollinations key». */
export function byopRequiredError(message = 'Connect your Pollinations account to generate.') {
    return Object.assign(new Error(message), { code: 'byop_required', requiresByop: true });
}
