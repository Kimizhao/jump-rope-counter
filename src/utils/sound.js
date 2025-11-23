// Simple Web Audio API context
// We defer creation or ensure we handle suspension correctly
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const initAudio = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    // Play a silent sound to unlock audio on some devices
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0; // Silent
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.01);
};

export const playJumpSound = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Sound configuration - Lower pitch for "thicker" sound
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); // Start at 600Hz (was 800)
    oscillator.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1); // Drop to 300Hz (was 400)

    // Volume envelope
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
};

export const playCountdownBeep = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // "Red Light" - Triangle wave is mellower than square, lower pitch is "thicker"
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(300, audioCtx.currentTime); // Lower pitch

    // Quick attack and release
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.05); // Slightly louder to compensate for softer wave
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.4);
};

export const playStartBeep = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // "Green Light" - Triangle wave, distinct pitch but not harsh
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(500, audioCtx.currentTime);
    // Slide pitch up slightly for energy
    oscillator.frequency.linearRampToValueAtTime(500, audioCtx.currentTime + 0.3);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 2);
};

export const playFinishBeep = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Finish sound - Higher pitch, shorter duration (0.5s)
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); // Higher pitch
    oscillator.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.5);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 2);
};
