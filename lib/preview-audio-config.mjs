import {
  TRACK_INSTRUMENTS,
  GENRE_PROFILES,
  GENRE_TO_PROFILE_MAP,
  SUBGENRE_TO_PROFILE_MAP
} from '../js/config.js';

function mergeSettings(base, override) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    const baseValue = result[key];
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
    ) {
      result[key] = mergeSettings(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function resolvePreviewSoundProfile({
  style = 'house',
  subgenre = '',
  soundProfileMode
} = {}) {
  const useGenreSounds = soundProfileMode !== 'default';
  if (!useGenreSounds) return null;
  return SUBGENRE_TO_PROFILE_MAP[subgenre] ||
    GENRE_TO_PROFILE_MAP[String(style || 'house').toLowerCase()] ||
    GENRE_TO_PROFILE_MAP.default ||
    null;
}

/**
 * Resolve the exact instrument settings used by real-time Preview.
 * Performance reductions are deliberately opt-in through lowPower; offline
 * rendering can reuse the same genre patch without inheriting those limits.
 */
export function resolvePreviewTrackSettings(trackType, options = {}) {
  const {
    style = 'house',
    subgenre = '',
    soundProfileMode,
    lowPower = false
  } = options;
  const profile = resolvePreviewSoundProfile({ style, subgenre, soundProfileMode });
  const baseSettings = TRACK_INSTRUMENTS[trackType]?.settings || {};
  const profileSettings = profile
    ? (GENRE_PROFILES[profile]?.[trackType] || {})
    : {};
  const settings = mergeSettings(baseSettings, profileSettings);

  if (lowPower) {
    if (settings.oscillator?.type) {
      let type = settings.oscillator.type;
      if (type.includes('fat')) type = type.replace('fat', '');
      if (type === 'pwm' || type === 'fmsquare') type = 'square';
      settings.oscillator.type = type;
      delete settings.oscillator.count;
      delete settings.oscillator.spread;
    }
    if (settings.envelope) {
      if (Number.isFinite(settings.envelope.release)) {
        settings.envelope.release = Math.min(settings.envelope.release, 0.25);
      }
      if (Number.isFinite(settings.envelope.attack) && settings.envelope.attack < 0.008) {
        settings.envelope.attack = 0.008;
      }
    }
  }

  if (settings.oscillator?.type === 'fatcustom') {
    settings.oscillator = {
      type: 'fatsine',
      count: settings.oscillator.count || 3,
      spread: settings.oscillator.spread || 40
    };
  } else if (settings.oscillator?.type === 'custom') {
    settings.oscillator = { type: 'sine' };
  }

  if (trackType === 'pad-textures' && settings.envelope?.attack > 1.2) {
    settings.envelope.attack = 1.2;
  }
  if (Number.isFinite(settings.envelope?.attack) && settings.envelope.attack < 0.008) {
    settings.envelope.attack = 0.008;
  }
  if (Number.isFinite(settings.envelope?.release) && settings.envelope.release < 0.05) {
    settings.envelope.release = 0.05;
  }

  return settings;
}


/**
 * Apply the shared Preview oscillator, envelope and filter configuration to an
 * offline synth patch. AI-selected instrument architecture, articulation,
 * level, pan and effects remain intact; percussion always uses its drum kit.
 */
export function applyPreviewSettingsToSynthPatch(trackType, synthPatch, options = {}) {
  if (!synthPatch || typeof synthPatch !== 'object' || trackType === 'percs') {
    return synthPatch;
  }

  const previewSettings = resolvePreviewTrackSettings(trackType, {
    ...options,
    lowPower: false
  });
  const result = {
    ...synthPatch,
    oscillator: previewSettings.oscillator
      ? { ...previewSettings.oscillator }
      : synthPatch.oscillator,
    envelope: previewSettings.envelope
      ? { ...previewSettings.envelope }
      : synthPatch.envelope
  };

  if (previewSettings.filter) {
    result.filter = { ...previewSettings.filter };
  } else {
    delete result.filter;
  }

  return result;
}
