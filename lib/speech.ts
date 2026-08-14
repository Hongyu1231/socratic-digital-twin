export interface SpeechVoiceOption {
  lang: string;
  name: string;
  localService?: boolean;
}

function normalizedLanguage(voice: SpeechVoiceOption) {
  return voice.lang.trim().toLowerCase().replace("_", "-");
}

/**
 * Prefer a locally installed Singapore or British English voice, then any
 * English voice. Returning undefined lets the browser use its default voice.
 */
export function selectPreferredEnglishVoice<T extends SpeechVoiceOption>(voices: T[]): T | undefined {
  const EnglishPriority = ["en-sg", "en-gb", "en-us", "en-au"];

  for (const language of EnglishPriority) {
    const localMatch = voices.find((voice) => normalizedLanguage(voice) === language && voice.localService !== false);
    if (localMatch) return localMatch;

    const match = voices.find((voice) => normalizedLanguage(voice) === language);
    if (match) return match;
  }

  return voices.find((voice) => normalizedLanguage(voice).startsWith("en-") && voice.localService !== false)
    ?? voices.find((voice) => normalizedLanguage(voice).startsWith("en"));
}
