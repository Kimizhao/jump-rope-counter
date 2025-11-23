// Simple Web Audio API context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const playJumpSound = () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Sound configuration
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // Start at 800Hz
    oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1); // Drop to 400Hz

    // Volume envelope
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
};
