/**
 * Small dependency-free JavaScript client for the AI MIDI Generator API.
 *
 * Works in Node.js 18+ and modern browsers. For public client applications,
 * do not embed a shared mgk_ key or a developer-owned Pollinations key.
 */
export class MidiApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'MidiApiError';
    this.status = status;
    this.body = body;
  }
}

export class MidiApiClient {
  constructor({
    apiKey,
    pollinationsKey,
    baseUrl = 'https://midi-aigenerator.vercel.app/api/v1'
  } = {}) {
    if (!apiKey) throw new TypeError('apiKey (mgk_...) is required.');
    if (!pollinationsKey) throw new TypeError('pollinationsKey is required for AI-powered requests.');
    this.apiKey = apiKey;
    this.pollinationsKey = pollinationsKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, { method = 'POST', body, signal, binary = false } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'X-Pollinations-Key': this.pollinationsKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      const raw = await response.text();
      let details;
      try { details = JSON.parse(raw); } catch { details = raw; }
      throw new MidiApiError(details?.error || `API request failed (HTTP ${response.status}).`, {
        status: response.status,
        body: details
      });
    }

    if (binary) return response.arrayBuffer();
    if (response.status === 204) return null;
    const raw = await response.text();
    try { return JSON.parse(raw); } catch { return raw; }
  }

  /** Generate notation JSON. Pass { format: 'midi' } to request a binary MIDI file. */
  generate(params, { format = 'json', signal } = {}) {
    const query = format === 'midi' ? '?format=midi' : '';
    return this.request(`/midi${query}`, {
      body: params,
      signal,
      binary: format === 'midi'
    });
  }

  /** Import a .mid file. midiBase64 must contain base64 data, not a local file path. */
  importMidi(midiBase64, options = {}, { signal } = {}) {
    return this.request('/import', {
      body: { midiBase64, ...options },
      signal
    });
  }

  /** Edit selected tracks in an existing composition. */
  editTracks(composition, options, { signal } = {}) {
    return this.request('/tracks/edit', {
      body: { composition, ...options },
      signal
    });
  }

  /** Check whether the mgk_ API key is active. */
  validateKey({ signal } = {}) {
    return this.request('/keys/validate', { method: 'GET', signal });
  }
}
