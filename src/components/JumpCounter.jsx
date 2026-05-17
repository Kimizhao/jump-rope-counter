import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { JumpDetector } from '../utils/poseUtils';
import { speak, initSpeech } from '../utils/speech';
import { playJumpSound, initAudio, playCountdownBeep, playStartBeep, playFinishBeep } from '../utils/sound';
import './JumpCounter.css';

const JumpCounter = () => {
    const webcamRef = useRef(null);
    const canvasRef = useRef(null);
    const videoWrapperRef = useRef(null);
    const [count, setCount] = useState(0);
    const countRef = useRef(0);
    const [isJumping, setIsJumping] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Game State: 'IDLE' | 'COUNTDOWN' | 'ACTIVE' | 'FINISHED'
    const [gameState, setGameState] = useState('IDLE');
    const [countdown, setCountdown] = useState(5);

    // Timer State
    const [selectedDuration, setSelectedDuration] = useState(60); // Default 1 min
    const [remainingTime, setRemainingTime] = useState(60);
    const remainingTimeRef = useRef(60);
    const [customMinutes, setCustomMinutes] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);

    // Immersive Controls State
    const [showControls, setShowControls] = useState(false);
    const controlsTimeoutRef = useRef(null);

    // UI Controls State
    const [showSkeleton, setShowSkeleton] = useState(true);
    const [showControlsPanel, setShowControlsPanel] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const controlsPanelRef = useRef(null);

    // Recording State
    const [enableRecording, setEnableRecording] = useState(true); // Enable by default
    const [isRecording, setIsRecording] = useState(false);
    const isRecordingRef = useRef(false);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const audioStreamRef = useRef(null);

    // Game Mode: 'single' | 'battle'
    const [gameMode, setGameMode] = useState('single');
    const gameModeRef = useRef('single');

    // Player 2 State (battle mode only)
    const [count2, setCount2] = useState(0);
    const count2Ref = useRef(0);
    const [isJumping2, setIsJumping2] = useState(false);

    // Refs for logic to avoid closure staleness in callbacks
    const detectorRef = useRef(new JumpDetector());
    const detector2Ref = useRef(new JumpDetector());
    const gameStateRef = useRef('IDLE');
    const isPausedRef = useRef(false);
    const poseLandmarkerRef = useRef(null);
    const drawingUtilsRef = useRef(null);
    const lastVideoTimeRef = useRef(-1);
    const animFrameRef = useRef(null);
    const playerAssignmentRef = useRef({ p1X: null, p2X: null });
    const timerRef = useRef(null);

    // Sync refs with state
    useEffect(() => { countRef.current = count; }, [count]);
    useEffect(() => { count2Ref.current = count2; }, [count2]);
    useEffect(() => { remainingTimeRef.current = remainingTime; }, [remainingTime]);
    useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        gameModeRef.current = gameMode;
    }, [gameMode]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            if (poseLandmarkerRef.current) poseLandmarkerRef.current.close();
        };
    }, []);

    // Timer Logic
    useEffect(() => {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (gameState === 'ACTIVE' && !isPaused) {
            timerRef.current = setInterval(() => {
                setRemainingTime(prev => {
                    const newValue = prev - 1;

                    // Countdown warning logic
                    if (newValue <= 5 && newValue > 0) {
                        if (isMobile) {
                            playCountdownBeep();
                        } else {
                            speak(newValue.toString());
                        }
                    }

                    if (newValue <= 0) {
                        if (isMobile) {
                            playFinishBeep();
                        }
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
                document.exitFullscreen().catch(err => console.error(err));
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [gameState, isPaused]);

    // Assign two detected poses to P1 (left) and P2 (right) stably across frames
    const assignPosesToPlayers = useCallback((lm0, lm1) => {
        const cx = (lm) => (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4;
        const x0 = cx(lm0);
        const x1 = cx(lm1);
        const { p1X, p2X } = playerAssignmentRef.current;

        if (p1X === null) {
            // First frame: assign by raw x position
            // Since webcam is mirrored, larger x is on the left side of the screen
            if (x0 >= x1) {
                playerAssignmentRef.current = { p1X: x0, p2X: x1 };
                return [lm0, lm1];
            } else {
                playerAssignmentRef.current = { p1X: x1, p2X: x0 };
                return [lm1, lm0];
            }
        }

        // Subsequent frames: nearest-neighbor cost to avoid swapping
        const costKeep = Math.abs(x0 - p1X) + Math.abs(x1 - p2X);
        const costSwap = Math.abs(x0 - p2X) + Math.abs(x1 - p1X);
        if (costKeep <= costSwap) {
            playerAssignmentRef.current = { p1X: x0, p2X: x1 };
            return [lm0, lm1];
        } else {
            playerAssignmentRef.current = { p1X: x1, p2X: x0 };
            return [lm1, lm0];
        }
    }, []);

    const processResults = useCallback((results) => {
        const canvas = canvasRef.current;
        const video = webcamRef.current?.video;
        if (!canvas || !video) return;

        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the unmirrored video, but flip it horizontally so it acts like a mirror
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Draw skeleton(s) for all detected poses (also flipped)
        if (results.landmarks && results.landmarks.length > 0) {
            if (!drawingUtilsRef.current) {
                drawingUtilsRef.current = new DrawingUtils(ctx);
            }
            for (const landmarks of results.landmarks) {
                drawingUtilsRef.current.drawConnectors(
                    landmarks, PoseLandmarker.POSE_CONNECTIONS,
                    { color: '#00FF00', lineWidth: 4 }
                );
                drawingUtilsRef.current.drawLandmarks(
                    landmarks, { color: '#FF0000', radius: 3 }
                );
            }
        }
        ctx.restore(); // Restore from flipped state

        // Draw UI on Canvas for Recording
        if (gameStateRef.current === 'ACTIVE' && isRecordingRef.current) {
            ctx.save();
            ctx.font = 'bold 36px sans-serif';
            ctx.textBaseline = 'top';
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#000000';

            const timeText = `${Math.floor(remainingTimeRef.current / 60)}:${(remainingTimeRef.current % 60).toString().padStart(2, '0')}`;

            if (gameModeRef.current === 'single') {
                const text = `次数: ${countRef.current}`;
                ctx.fillStyle = '#4ade80';
                ctx.strokeText(text, 20, 20);
                ctx.fillText(text, 20, 20);

                ctx.fillStyle = remainingTimeRef.current <= 5 ? '#ef4444' : '#ffffff';
                ctx.textAlign = 'right';
                ctx.strokeText(`时间: ${timeText}`, canvas.width - 20, 20);
                ctx.fillText(`时间: ${timeText}`, canvas.width - 20, 20);
            } else {
                // Battle mode
                ctx.fillStyle = '#3b82f6';
                ctx.textAlign = 'left';
                ctx.strokeText(`P1: ${countRef.current}`, 20, 20);
                ctx.fillText(`P1: ${countRef.current}`, 20, 20);

                ctx.fillStyle = '#ef4444';
                ctx.textAlign = 'right';
                ctx.strokeText(`P2: ${count2Ref.current}`, canvas.width - 20, 20);
                ctx.fillText(`P2: ${count2Ref.current}`, canvas.width - 20, 20);

                ctx.fillStyle = remainingTimeRef.current <= 5 ? '#ef4444' : '#facc15';
                ctx.textAlign = 'center';
                ctx.strokeText(timeText, canvas.width / 2, 20);
                ctx.fillText(timeText, canvas.width / 2, 20);
            }
            ctx.restore();
        }

        // Only run detection logic if game is ACTIVE and not paused
        if (gameStateRef.current === 'ACTIVE' && !isPausedRef.current) {
        const poses = results.landmarks ?? [];
        let p1Pose = null;
        let p2Pose = null;

        if (gameModeRef.current === 'battle' && poses.length > 0) {
            if (poses.length >= 2) {
                const [p1lm, p2lm] = assignPosesToPlayers(poses[0], poses[1]);
                p1Pose = p1lm;
                p2Pose = p2lm;
            } else if (poses.length === 1) {
                // Only one person visible — determine if it's P1 or P2
                const cx = (lm) => (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4;
                const x = cx(poses[0]);
                const { p1X, p2X } = playerAssignmentRef.current;
                
                let isP1 = true;
                if (p1X !== null && p2X !== null) {
                    isP1 = Math.abs(x - p1X) <= Math.abs(x - p2X);
                } else {
                    isP1 = x >= 0.5; // Default to P1 if on the left side of the screen (larger x)
                }

                if (isP1) {
                    if (p1X !== null) playerAssignmentRef.current.p1X = x;
                    p1Pose = poses[0];
                } else {
                    if (p2X !== null) playerAssignmentRef.current.p2X = x;
                    p2Pose = poses[0];
                }
            }
        }

        // Draw P1 / P2 labels in battle mode
        if (poses.length > 0) {
            if (gameModeRef.current === 'battle') {
                const drawLabel = (pose, text, color) => {
                    if (!pose) return;
                    const nose = pose[0];
                    if (!nose) return;
                    
                    const x = canvas.width - (nose.x * canvas.width); // Mirrored X
                    const y = nose.y * canvas.height - 40; // slightly above head
                    
                    ctx.save();
                    ctx.translate(x, y);
                    
                    ctx.font = 'bold 28px sans-serif';
                    ctx.textAlign = 'center';
                    
                    // Draw text outline
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 4;
                    ctx.strokeText(text, 0, 0);
                    
                    // Draw text fill
                    ctx.fillStyle = color;
                    ctx.fillText(text, 0, 0);
                    
                    ctx.restore();
                };

                drawLabel(p1Pose, 'P1', '#3b82f6'); // Blue
                drawLabel(p2Pose, 'P2', '#ef4444'); // Red
            }
        }

        // Only run detection logic if game is ACTIVE and not paused
        if (gameStateRef.current === 'ACTIVE' && !isPausedRef.current) {
            if (gameModeRef.current === 'battle') {
                if (p1Pose) {
                    const { count: c1, state: s1 } = detectorRef.current.update(p1Pose);
                    setCount(prev => { if (prev !== c1) { playJumpSound(); return c1; } return prev; });
                    setIsJumping(s1 === 'AIRBORNE' || s1 === 'JUMP_START');
                } else {
                    setIsJumping(false);
                }

                if (p2Pose) {
                    const { count: c2, state: s2 } = detector2Ref.current.update(p2Pose);
                    setCount2(prev => { if (prev !== c2) { playJumpSound(); return c2; } return prev; });
                    setIsJumping2(s2 === 'AIRBORNE' || s2 === 'JUMP_START');
                } else {
                    setIsJumping2(false);
                }
            } else {
                if (poses.length > 0) {
                    const { count: newCount, state } = detectorRef.current.update(poses[0]);
                    setCount(prev => {
                        if (prev !== newCount) {
                            playJumpSound();
                            return newCount;
                        }
                        return prev;
                    });
                    setIsJumping(state === 'AIRBORNE' || state === 'JUMP_START');
                }
            }
        }
        }

        ctx.restore();
    }, [assignPosesToPlayers]);

    const onCamLoaded = async () => {
        setIsLoading(false);
        const videoElement = webcamRef.current?.video;
        if (!videoElement || poseLandmarkerRef.current) return;

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: '/mediapipe/tasks/pose_landmarker_lite.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numPoses: 2,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false
        });
        poseLandmarkerRef.current = landmarker;

        const runDetection = (timestamp) => {
            const video = webcamRef.current?.video;
            const lm = poseLandmarkerRef.current;
            if (video && lm && video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
                lastVideoTimeRef.current = video.currentTime;
                const results = lm.detectForVideo(video, timestamp);
                processResults(results);
            }
            animFrameRef.current = requestAnimationFrame(runDetection);
        };
        animFrameRef.current = requestAnimationFrame(runDetection);

        // 自动进入全屏
        setTimeout(() => {
            enterFullscreen(videoWrapperRef.current);
        }, 500);
    };

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

    const startSession = () => {
        // Initialize Audio Context on user interaction (Mobile support)
        initAudio();
        // Initialize Speech Synthesis
        initSpeech();

        // Request Fullscreen immediately on user interaction
        enterFullscreen(videoWrapperRef.current);

        setGameState('COUNTDOWN');
        setCountdown(5);
        setRemainingTime(selectedDuration); // Reset timer

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
            playCountdownBeep(); // F1 Beep for mobile
        } else {
            speak('5'); // Voice for desktop
        }

        let currentCount = 5;
        const timer = setInterval(() => {
            currentCount--;
            setCountdown(currentCount);

            if (currentCount > 0) {
                if (isMobile) {
                    playCountdownBeep();
                } else {
                    speak(currentCount.toString());
                }
            } else if (currentCount === 0) {
                if (isMobile) {
                    playStartBeep();
                } else {
                    speak('开始');
                }

                clearInterval(timer);
                detectorRef.current.reset();
                setCount(0);
                setIsPaused(false);

                // Reset P2 in battle mode
                if (gameModeRef.current === 'battle') {
                    detector2Ref.current.reset();
                    setCount2(0);
                    setIsJumping2(false);
                    playerAssignmentRef.current = { p1X: null, p2X: null };
                }

                setGameState('ACTIVE');
                // 如果启用录制，则启动录制
                if (enableRecording) {
                    startRecording();
                }
            }
        }, 1000);
    };

    const enterFullscreen = (element) => {
        if (!element) return;

        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => console.error(err));
        } else if (element.webkitRequestFullscreen) { /* Safari */
            element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) { /* IE11 */
            element.msRequestFullscreen();
        }
    };

    const startRecording = async () => {
        try {
            const canvasElement = canvasRef.current;
            if (!canvasElement) {
                return;
            }

            recordedChunksRef.current = [];
            // 获取 Canvas 视频流，30帧
            const canvasStream = canvasElement.captureStream(30);

            // 获取麦克风音频流
            let combinedStream;
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioStreamRef.current = audioStream;

                // 合并视频轨道和音频轨道
                combinedStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...audioStream.getAudioTracks()
                ]);
            } catch (audioError) {
                // 如果无法获取音频，只录制视频
                combinedStream = canvasStream;
            }

            // 选择最佳的 MIME 类型，优先尝试 mp4
            let mimeType = 'video/webm';
            const typesToTry = [
                'video/mp4;codecs=avc1',
                'video/mp4',
                'video/webm;codecs=h264',
                'video/webm;codecs=vp9,opus',
                'video/webm'
            ];

            for (const t of typesToTry) {
                if (MediaRecorder.isTypeSupported(t)) {
                    mimeType = t;
                    break;
                }
            }

            const options = { mimeType };
            const mediaRecorder = new MediaRecorder(combinedStream, options);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunksRef.current, { type: mimeType });

                // 停止音频轨道
                if (audioStreamRef.current) {
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                }

                setIsRecording(false);

                // 生成文件名，包含日期和跳绳次数
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 19).replace(/:/g, '-');
                const c1 = detectorRef.current.jumpCount;
                
                // 如果是 webm 但带有 h264 编码，有些场景下强转 mp4 后缀可以被部分播放器识别，但为了规范，根据 mimeType 决定后缀
                // 若用户强需 mp4，这里优先分配 mp4
                const ext = mimeType.includes('mp4') ? 'mp4' : 'mp4'; // 用户要求强制 mp4 后缀，即便底层可能是 webm，现代播放器基本都能兼容
                
                const filename = gameModeRef.current === 'battle'
                    ? `跳绳对战_P1_${c1}次_P2_${detector2Ref.current.jumpCount}次_${dateStr}.${ext}`
                    : `跳绳录像_${c1}次_${dateStr}.${ext}`;

                // 下载视频
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
        } catch (error) {
            // Recording failed silently
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        // 确保音频流被停止
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(track => track.stop());
            audioStreamRef.current = null;
        }
    };

    const stopSession = () => {
        setGameState('IDLE');
        setIsJumping(false);
        setIsJumping2(false);
        setIsPaused(false);
        if (timerRef.current) clearInterval(timerRef.current);
        // 停止录制
        stopRecording();
    };

    const togglePause = () => {
        setIsPaused(!isPaused);
    };

    const finishSession = () => {
        setGameState('FINISHED');
        setIsJumping(false);
        setIsJumping2(false);
        // 停止录制
        stopRecording();

        const c1 = detectorRef.current.jumpCount;
        const c2 = detector2Ref.current.jumpCount;
        if (gameModeRef.current === 'battle') {
            if (c1 > c2) speak('P1 获胜');
            else if (c2 > c1) speak('P2 获胜');
            else speak('平局');
        } else {
            speak('时间到，运动结束');
        }
    };

    const handleOverlayClick = (e) => {
        // Close controls panel when clicking outside of it
        if (controlsPanelRef.current && !controlsPanelRef.current.contains(e.target)) {
            setShowControlsPanel(false);
        }
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
                className={`video-wrapper ${gameState === 'ACTIVE' ? 'active-mode' : ''}`}
                ref={videoWrapperRef}
                onMouseMove={handleInteraction}
                onTouchStart={handleInteraction}
                onClick={gameState === 'ACTIVE' ? handleInteraction : handleOverlayClick}
            >
                {isLoading && <div className="loading-overlay">正在加载 AI 模型...</div>}

                {/* Single mode: Active Overlay Stats */}
                {gameState === 'ACTIVE' && gameMode === 'single' && !isRecording && (
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

                        {/* Fullscreen Status Indicator */}
                        <div className={`overlay-status ${isJumping ? 'jumping' : isPaused ? 'paused' : ''}`}>
                            {isPaused ? '已暂停' : (isJumping ? '跳！' : '运动中')}
                        </div>
                    </>
                )}

                {/* Battle mode: Active Overlay Stats */}
                {gameState === 'ACTIVE' && gameMode === 'battle' && !isRecording && (
                    <>
                        {/* Shared timer centered at top */}
                        <div className="overlay-stat top-center">
                            <div className={`overlay-value ${remainingTime <= 5 ? 'warning' : ''}`}>
                                {formatTime(remainingTime)}
                            </div>
                            <div className="overlay-label">时间</div>
                        </div>

                        {/* P1 left panel */}
                        <div className="battle-player-stat left">
                            <div className="player-label">P1</div>
                            <div className={`overlay-value ${isJumping ? 'jumping-val' : ''}`}>{count}</div>
                            <div className="overlay-label">次数</div>
                        </div>

                        {/* P2 right panel */}
                        <div className="battle-player-stat right">
                            <div className="player-label">P2</div>
                            <div className={`overlay-value ${isJumping2 ? 'jumping-val' : ''}`}>{count2}</div>
                            <div className="overlay-label">次数</div>
                        </div>

                        {/* Vertical center divider */}
                        <div className="battle-divider" />

                        {isPaused && <div className="overlay-status paused">已暂停</div>}
                    </>
                )}

                {/* Immersive Controls (both modes) */}
                {gameState === 'ACTIVE' && (
                    <>
                        <div className={`immersive-controls ${showControls ? 'visible' : ''}`}>
                            <button className="control-btn pause-btn" onClick={togglePause}>
                                {isPaused ? '▶️ 继续' : '⏸️ 暂停'}
                            </button>
                            <button className="control-btn stop-btn" onClick={stopSession}>
                                停止并重置
                            </button>
                        </div>

                        {/* Recording Indicator */}
                        {isRecording && (
                            <div className="recording-indicator">
                                <span className="recording-dot"></span>
                                <span className="recording-text">录制中</span>
                            </div>
                        )}
                    </>
                )}

                {gameState === 'COUNTDOWN' && (
                    <div className="countdown-overlay">
                        <div className="countdown-number">{countdown}</div>
                        <div className="countdown-text">准备！</div>
                    </div>
                )}

                {/* Single mode: Finished screen */}
                {gameState === 'FINISHED' && gameMode === 'single' && (
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

                {/* Battle mode: Finished screen */}
                {gameState === 'FINISHED' && gameMode === 'battle' && (
                    <div className="countdown-overlay">
                        <div className="battle-results">
                            <div className="winner-display">
                                {count > count2 ? 'P1 获胜! 🏆' : count2 > count ? 'P2 获胜! 🏆' : '平局!'}
                            </div>
                            <div className="player-results">
                                <div className={`player-result ${count >= count2 ? 'winner' : ''}`}>
                                    <span className="player-name">P1</span>
                                    <span className="player-count">{count} 次</span>
                                </div>
                                <div className={`player-result ${count2 >= count ? 'winner' : ''}`}>
                                    <span className="player-name">P2</span>
                                    <span className="player-count">{count2} 次</span>
                                </div>
                            </div>
                            <button className="control-btn start-btn" onClick={() => setGameState('IDLE')} style={{ marginTop: 20 }}>
                                返回
                            </button>
                        </div>
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
                    style={{ display: showSkeleton ? 'block' : 'none' }}
                />

                {/* Toggle Buttons - Bottom Right */}
                {gameState !== 'ACTIVE' && gameState !== 'COUNTDOWN' && (
                    <div className="video-control-buttons">
                        <button
                            className="icon-control-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowSkeleton(!showSkeleton);
                            }}
                            title={showSkeleton ? '隐藏骨架' : '显示骨架'}
                        >
                            {showSkeleton ? '🦴' : '👁️'}
                        </button>
                        <button
                            className="icon-control-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowControlsPanel(!showControlsPanel);
                            }}
                            title={showControlsPanel ? '隐藏控制面板' : '显示控制面板'}
                        >
                            {showControlsPanel ? '✕' : '☰'}
                        </button>
                    </div>
                )}
            </div>

            {/* Main controls panel overlayed */}
            {gameState !== 'ACTIVE' && showControlsPanel && (
                <div
                    ref={controlsPanelRef}
                    className={`controls-panel ${showControlsPanel ? 'visible' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="stats-group">
                        <div className="count-display">
                            <span className="label">跳绳次数</span>
                            <span className="value">{count}{gameMode === 'battle' ? ` / ${count2}` : ''}</span>
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
                            {/* Mode Selector */}
                            <div className="mode-selector">
                                <button
                                    className={`mode-btn ${gameMode === 'single' ? 'active' : ''}`}
                                    onClick={() => setGameMode('single')}
                                >
                                    单人
                                </button>
                                <button
                                    className={`mode-btn ${gameMode === 'battle' ? 'active' : ''}`}
                                    onClick={() => setGameMode('battle')}
                                >
                                    双人对战
                                </button>
                            </div>

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

                            <div className="recording-toggle">
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={enableRecording}
                                        onChange={(e) => setEnableRecording(e.target.checked)}
                                        className="toggle-checkbox"
                                    />
                                    <span className="toggle-slider"></span>
                                    <span className="toggle-text">录制视频</span>
                                </label>
                            </div>

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
