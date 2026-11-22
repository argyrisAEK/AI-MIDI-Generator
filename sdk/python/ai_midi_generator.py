"""Dependency-free Python client for the AI MIDI Generator API (Python 3.9+)."""
import json
import urllib.error
import urllib.parse
import urllib.request


class MidiApiError(Exception):
    def __init__(self, message, status=0, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class MidiApiClient:
    def __init__(
        self,
        api_key,
        pollinations_key,
        base_url="https://midi-aigenerator.vercel.app/api/v1",
        timeout=90,
    ):
        if not api_key:
            raise ValueError("api_key (mgk_...) is required")
        self.api_key = api_key
        self.pollinations_key = pollinations_key or None
        self.base_url = base_url.rstrip("/")
        self.site_base = self.base_url.removesuffix("/api/v1")
        self.timeout = timeout

    def _request(self, path, body=None, binary=False, method="POST"):
        headers = {
            "Authorization": "Bearer " + self.api_key,
            "Accept": "application/json, audio/midi, text/plain",
        }
        if self.pollinations_key:
            headers["X-Pollinations-Key"] = self.pollinations_key
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                if binary:
                    return raw
                text = raw.decode("utf-8")
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return text
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                details = json.loads(raw)
            except json.JSONDecodeError:
                details = raw
            message = details.get("error", str(error)) if isinstance(details, dict) else str(error)
            raise MidiApiError(message, error.code, details) from error
        except urllib.error.URLError as error:
            raise MidiApiError("Could not reach the MIDI API: " + str(error.reason)) from error

    def _require_pollinations_key(self):
        if not self.pollinations_key:
            raise ValueError("pollinations_key is required for generate, import_midi, and edit_tracks. It is not needed for validate_key().")

    def generate(self, params, output="json"):
        """Generate MIDI notation JSON, or raw .mid bytes when output='midi'."""
        self._require_pollinations_key()
        path = "/midi?format=midi" if output == "midi" else "/midi"
        return self._request(path, body=params, binary=(output == "midi"))

    def import_midi(self, midi_base64, **options):
        """Import a base64-encoded Standard MIDI File."""
        self._require_pollinations_key()
        return self._request("/import", body={"midiBase64": midi_base64, **options})

    def edit_tracks(self, composition, **options):
        """Edit selected tracks in an existing composition."""
        self._require_pollinations_key()
        return self._request("/tracks/edit", body={"composition": composition, **options})

    def validate_key(self):
        request = urllib.request.Request(
            self.site_base + "/api/keys/validate",
            headers={"Authorization": "Bearer " + self.api_key},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                details = json.loads(raw)
            except json.JSONDecodeError:
                details = raw
            message = details.get("error", str(error)) if isinstance(details, dict) else str(error)
            raise MidiApiError(message, error.code, details) from error
        except urllib.error.URLError as error:
            raise MidiApiError("Could not reach the MIDI API: " + str(error.reason)) from error
