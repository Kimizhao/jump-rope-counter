export class JumpDetector {
    constructor() {
        this.isJumping = false;
        this.jumpCount = 0;
        this.groundY = null;

        // Hand tracking
        this.wristYHistory = [];
        this.HISTORY_SIZE = 10; // Track last ~10 frames for hand movement
        this.isHandsActive = false;
    }

    /**
     * Processes pose landmarks to detect jumps.
     * @param {Array} landmarks - Array of landmark objects {x, y, z, visibility}
     * @returns {Object} - { count, state, debugInfo }
     */
    update(landmarks) {
        if (!landmarks || landmarks.length < 33) return { count: this.jumpCount, state: 'NO_POSE' };

        // Landmarks: 
        // 23: left_hip, 24: right_hip
        // 11: left_shoulder, 12: right_shoulder
        // 15: left_wrist, 16: right_wrist
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];

        // Check visibility
        const minVisibility = 0.5;
        if (leftHip.visibility < minVisibility || rightHip.visibility < minVisibility) {
            return { count: this.jumpCount, state: 'POOR_VISIBILITY' };
        }

        const midHipY = (leftHip.y + rightHip.y) / 2;
        const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const midWristY = (leftWrist.y + rightWrist.y) / 2;

        // Calculate torso height as reference scale for the threshold
        const torsoHeight = Math.abs(midHipY - midShoulderY);

        // --- Hand Movement Detection ---
        this.updateHandHistory(midWristY);
        const handAmplitude = this.getHandAmplitude();
        // Threshold: Hands should move at least 5% of torso height to be considered "turning"
        // And hands should generally be below shoulders (y is larger downwards)
        const handThreshold = torsoHeight * 0.05;
        const handsBelowShoulders = midWristY > midShoulderY;

        this.isHandsActive = handAmplitude > handThreshold && handsBelowShoulders;

        // --- Jump Detection ---

        // Initialize groundY if needed
        if (this.groundY === null) {
            this.groundY = midHipY;
        }

        // Dynamic threshold: 15% of torso height seems like a reasonable jump height start
        const jumpThreshold = torsoHeight * 0.15;

        // Drift correction for ground level
        if (!this.isJumping && Math.abs(midHipY - this.groundY) < jumpThreshold * 0.5) {
            this.groundY = this.groundY * 0.95 + midHipY * 0.05;
        }

        let state = this.isJumping ? 'AIRBORNE' : 'GROUNDED';

        // Detect Jump Start
        // Must satisfy: 
        // 1. Hip moves up significantly
        // 2. Hands are moving (shaking/turning rope)
        if (!this.isJumping && midHipY < (this.groundY - jumpThreshold)) {
            // Only trigger jump if hands are active (or if we want to be lenient, we can warn)
            // For now, we strictly require hand movement as requested.
            if (this.isHandsActive) {
                this.isJumping = true;
                this.jumpCount++;
                state = 'JUMP_START';
            }
        }

        // Detect Landing
        if (this.isJumping && midHipY > (this.groundY - jumpThreshold * 0.8)) {
            this.isJumping = false;
            state = 'LANDED';
        }

        return {
            count: this.jumpCount,
            state,
            debug: {
                midHipY,
                groundY: this.groundY,
                threshold: jumpThreshold,
                handAmplitude,
                isHandsActive: this.isHandsActive
            }
        };
    }

    updateHandHistory(y) {
        this.wristYHistory.push(y);
        if (this.wristYHistory.length > this.HISTORY_SIZE) {
            this.wristYHistory.shift();
        }
    }

    getHandAmplitude() {
        if (this.wristYHistory.length < 2) return 0;
        let min = Infinity;
        let max = -Infinity;
        for (const y of this.wristYHistory) {
            if (y < min) min = y;
            if (y > max) max = y;
        }
        return max - min;
    }

    reset() {
        this.jumpCount = 0;
        this.isJumping = false;
        this.groundY = null;
        this.wristYHistory = [];
        this.isHandsActive = false;
    }
}
