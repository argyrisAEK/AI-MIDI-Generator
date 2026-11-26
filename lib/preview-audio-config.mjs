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

/**
 * Shared full-power Preview/offline master-bus settings.
 * lowPower affects only whether the spatial send is enabled; the core
 * compressor and limiter remain consistent between both rendering paths.
 */
export function getPreviewMasterEffectsSettings({ lowPower = false } = {}) {
  return {
    limiterThresholdDb: -3,
    compressor: {
      threshold: -14,
      ratio: 4,
      attack: 0.005,
      release: 0.15,
      knee: 6
    },
    spatialEffectsEnabled: !lowPower,
    delay: {
      delayTime: '8n',
      feedback: 0.2,
      wet: 0.15
    },
    reverb: {
      decay: 2.5,
      preDelay: 0.01,
      wet: 0.2
    }
  };
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


export function isSupportedOfflineTrackType(trackType) {
  return Boolean(TRACK_INSTRUMENTS[trackType]);
}

/**
 * Build a deterministic offline patch from the same instrument configuration
 * used by Preview. No AI patch or network request is required for WAV export.
 * Percussion settings are passed through only for level metadata: AudioRenderer
 * detects trackType === 'percs' and uses its dedicated drum-kit implementation.
 */
export function createOfflinePreviewSynthSettings(trackType, options = {}) {
  const instrumentConfig = TRACK_INSTRUMENTS[trackType];
  if (!instrumentConfig) {
    throw new Error(`Unsupported track type for offline audio: ${trackType}`);
  }

  const previewSettings = resolvePreviewTrackSettings(trackType, {
    ...options,
    lowPower: false
  });
  const mixVolume = Number.isFinite(instrumentConfig.mixVolume)
    ? Math.max(0.001, instrumentConfig.mixVolume)
    : 0.6;

  return {
    instrumentType: ['bass', 'lead'].includes(instrumentConfig.type) ? 'MonoSynth' : 'PolySynth',
    oscillator: { ...(previewSettings.oscillator || { type: 'sawtooth' }) },
    envelope: { ...(previewSettings.envelope || { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }) },
    ...(previewSettings.filter ? { filter: { ...previewSettings.filter } } : {}),
    volume: 20 * Math.log10(mixVolume),
    pan: 0
  };
}
