// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

/**
 * Plays text using the browser Web Speech API.
 * This is a fallback when no downloadable TTS provider is injected.
 *
 * @param text - The text to speak aloud.
 * @returns A promise that resolves when speech synthesis completes.
 * @throws Error if speech synthesis is not available in the browser.
 */
export const speakWithWebSpeech = (text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis is not available in this browser.'));
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);

    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Speech synthesis failed.'));

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });