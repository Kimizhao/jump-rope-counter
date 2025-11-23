export const speak = (text, lang = 'zh-CN') => {
    if (!window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.0;
    utterance.pitch = 1.2; // Slightly higher pitch for "girl" voice

    // Try to find a female voice
    const voices = window.speechSynthesis.getVoices();

    // Strategy: Look for "Female" or specific known female voice names
    // On Mac, "Ting-Ting" is good for Chinese, "Samantha" for English.
    // We prioritize Chinese voices since the user asked in Chinese.
    const femaleVoice = voices.find(v =>
        (v.name.includes('Ting-Ting') || v.name.includes('Yu-shu') || v.name.includes('Ya-ling')) || // Common Chinese female voices
        (v.lang === lang && v.name.includes('Female')) ||
        (v.lang === lang) // Fallback to any voice in that language
    );

    if (femaleVoice) {
        utterance.voice = femaleVoice;
    }

    window.speechSynthesis.speak(utterance);
};

// Pre-load voices (they load asynchronously in some browsers)
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
}
