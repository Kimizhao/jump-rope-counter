import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { JumpDetector } from '../utils/poseUtils';
import { speak } from '../utils/speech';
import { playJumpSound } from '../utils/sound';
import './JumpCounter.css';

const JumpCounter = () => {
    const webcamRef = useRef(null);
    const canvasRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const [count, setCount] = useState(0);
    const [isJumping, setIsJumping] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Game State: 'IDLE' | 'COUNTDOWN' | 'ACTIVE' | 'FINISHED'
    const [gameState, setGameState] = useState('IDLE');
    const [countdown, setCountdown] = useState(5);

    // Timer State
    const [selectedDuration, setSelectedDuration] = useState(60); // Default 1 min
    const [remainingTime, setRemainingTime] = useState(60);
    const [customMinutes, setCustomMinutes] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);

    // Immersive Controls State
    const [showControls, setShowControls] = useState(false);
    const controlsTimeoutRef = useRef(null);

    // Refs for logic to avoid closure staleness in callbacks
    const detectorRef = useRef(new JumpDetector());
    const gameStateRef = useRef('IDLE');
    const cameraRef = useRef(null);
    const poseRef = useRef(null);
    const timerRef = useRef(null);

    // Sync ref with state
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    // Timer Logic
    useEffect(() => {
        if (gameState === 'ACTIVE') {
            timerRef.current = setInterval(() => {
                setRemainingTime(prev => {
                    const newValue = prev - 1;

                    // Countdown warning logic
                    if (newValue <= 5 && newValue > 0) {
                        speak(newValue.toString());
                    }

                    if (newValue <= 0) {
                        clearInterval(timerRef.current);
                        finishSession();
                        return 0;
                    }
                    return newValue;
                });
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);

            // Exit fullscreen if finished or idle (and currently in fullscreen)
            if (document.fullscreenElement && (gameState === 'FINISHED' || gameState === 'IDLE')) {
                document.exitFullscreen().catch(err => console.log(err));
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [gameState]);

    // Handle User Interaction for Immersive Controls
    const handleInteraction = () => {
        if (gameState === 'ACTIVE') {
            setShowControls(true);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 3000);
        }
    };

    const onResults = useCallback((results) => {
        const canvas = canvasRef.current;
        if (!canvas || !results.poseLandmarks) return;

        const ctx = canvas.getContext('2d');
        const { width, height } = canvas;

        ctx.save();
        ctx.clearRect(0, 0, width, height);

        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS,
            { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(ctx, results.poseLandmarks,
            { color: '#FF0000', lineWidth: 2 });

        // Only run detection logic if game is ACTIVE
        if (gameStateRef.current === 'ACTIVE') {
            const { count: newCount, state } = detectorRef.current.update(results.poseLandmarks);
            setCount(prev => {
                if (prev !== newCount) {
                    playJumpSound(); // Play sound on count change
                    return newCount;
                }
                return prev;
            });
            setIsJumping(state === 'AIRBORNE' || state === 'JUMP_START');
        }

        ctx.restore();
    }, []);

    const onCamLoaded = (stream) => {
        setIsLoading(false);
        if (webcamRef.current && webcamRef.current.video && !cameraRef.current) {
            const videoElement = webcamRef.current.video;
            const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });

            pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                enableSegmentation: false,
                smoothSegmentation: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            pose.onResults(onResults);
            poseRef.current = pose;

            const camera = new Camera(videoElement, {
                onFrame: async () => {
                    await pose.send({ image: videoElement });
                },
                width: 640,
                height: 480
            });
            camera.start();
            cameraRef.current = camera;
        }
    };

    const startSession = () => {
        // Request Fullscreen immediately on user interaction
        if (videoWrapperRef.current && document.fullscreenElement === null) {
            videoWrapperRef.current.requestFullscreen().catch(err => {
                console.log(`Error attempting to enable fullscreen: ${err.message}`);
            });
        }

        setGameState('COUNTDOWN');
        setCountdown(5);
        setRemainingTime(selectedDuration); // Reset timer
        speak('5');

        let currentCount = 5;
        const timer = setInterval(() => {
            currentCount--;
            setCountdown(currentCount);

            if (currentCount > 0) {
                speak(currentCount.toString());
            } else if (currentCount === 0) {
                speak('开始');
                clearInterval(timer);
                detectorRef.current.reset();
                setCount(0);
                setGameState('ACTIVE');
            }
        }, 1000);
    };

    const stopSession = () => {
        setGameState('IDLE');
        setIsJumping(false);
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const finishSession = () => {
        setGameState('FINISHED');
        setIsJumping(false);
        speak('时间到，运动结束');
    };

    const handleDurationSelect = (minutes) => {
        setSelectedDuration(minutes * 60);
        setShowCustomInput(false);
    };

    const handleCustomDuration = () => {
        const mins = parseInt(customMinutes);
        if (mins > 0) {
            setSelectedDuration(mins * 60);
            setShowCustomInput(false);
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="jump-counter-container">
            <div
                className="video-wrapper"
                ref={videoWrapperRef}
                onMouseMove={handleInteraction}
                onTouchStart={handleInteraction}
                onClick={handleInteraction}
            >
                {isLoading && <div className="loading-overlay">正在加载 AI 模型...</div>}

                {/* Active Overlay Stats */}
                {gameState === 'ACTIVE' && (
                    <>
                        <div className="overlay-stat top-left">
                            <div className="overlay-value">{count}</div>
                            <div className="overlay-label">次数</div>
                        </div>
                        <div className="overlay-stat top-right">
                            <div className={`overlay-value ${remainingTime <= 5 ? 'warning' : ''}`}>
                                {formatTime(remainingTime)}
                            </div>
                            <div className="overlay-label">时间</div>
                        </div>

                        {/* Immersive Stop Button */}
                        <div className={`immersive-controls ${showControls ? 'visible' : ''}`}>
                            <button className="control-btn stop-btn" onClick={stopSession}>
                                停止并重置
                            </button>
                        </div>

                        {/* Fullscreen Status Indicator */}
                        <div className={`overlay-status ${isJumping ? 'jumping' : ''}`}>
                            {isJumping ? '跳！' : '运动中'}
                        </div>
                    </>
                )}

                {gameState === 'COUNTDOWN' && (
                    <div className="countdown-overlay">
                        <div className="countdown-number">{countdown}</div>
                        <div className="countdown-text">准备！</div>
                    </div>
                )}

                {gameState === 'FINISHED' && (
                    <div className="countdown-overlay">
                        <div className="countdown-number" style={{ fontSize: '4rem', color: '#4ade80' }}>
                            {count} 次
                        </div>
                        <div className="countdown-text">运动完成!</div>
                        <button className="control-btn start-btn" onClick={() => setGameState('IDLE')} style={{ marginTop: 20 }}>
                            返回
                        </button>
                    </div>
                )}

                <Webcam
                    ref={webcamRef}
                    className="webcam-feed"
                    onUserMedia={onCamLoaded}
                    width={640}
                    height={480}
                    mirrored={true}
                />
                <canvas
                    ref={canvasRef}
                    className="pose-overlay"
                    width={640}
                    height={480}
                />
            </div>

            {/* Hide main controls panel when ACTIVE */}
            {gameState !== 'ACTIVE' && (
                <div className="controls-panel">
                    <div className="stats-group">
                        <div className="count-display">
                            <span className="label">跳绳次数</span>
                            <span className="value">{count}</span>
                        </div>
                        <div className="timer-display">
                            <span className="label">剩余时间</span>
                            <span className="value">
                                {formatTime(remainingTime)}
                            </span>
                        </div>
                    </div>

                    <div className={`status-indicator ${isJumping ? 'active' : ''}`}>
                        {gameState === 'ACTIVE' ? (isJumping ? '跳！' : '运动中') :
                            gameState === 'FINISHED' ? '结束' : '准备就绪'}
                    </div>

                    {gameState === 'IDLE' ? (
                        <div className="setup-controls">
                            <div className="duration-selector">
                                {[1, 2, 3, 5, 10].map(min => (
                                    <button
                                        key={min}
                                        className={`duration-btn ${selectedDuration === min * 60 ? 'active' : ''}`}
                                        onClick={() => handleDurationSelect(min)}
                                    >
                                        {min}分
                                    </button>
                                ))}
                                <button
                                    className={`duration-btn ${showCustomInput ? 'active' : ''}`}
                                    onClick={() => setShowCustomInput(true)}
                                >
                                    自定义
                                </button>
                            </div>

                            {showCustomInput && (
                                <div className="custom-input-group">
                                    <input
                                        type="number"
                                        placeholder="分钟"
                                        value={customMinutes}
                                        onChange={(e) => setCustomMinutes(e.target.value)}
                                        className="custom-input"
                                    />
                                    <button className="confirm-btn" onClick={handleCustomDuration}>确定</button>
                                </div>
                            )}

                            <button className="control-btn start-btn" onClick={startSession}>
                                开始运动
                            </button>
                        </div>
                    ) : (
                        // Fallback for non-active states that might still need a stop button (e.g. COUNTDOWN)
                        <button className="control-btn stop-btn" onClick={stopSession} disabled={gameState === 'COUNTDOWN' || gameState === 'FINISHED'}>
                            {gameState === 'COUNTDOWN' ? '启动中...' : '停止并重置'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default JumpCounter;
