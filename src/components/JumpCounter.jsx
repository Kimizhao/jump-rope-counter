import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { JumpDetector } from '../utils/poseUtils';
import { speak, initSpeech } from '../utils/speech';
import { playJumpSound, initAudio, playCountdownBeep, playStartBeep, playFinishBeep } from '../utils/sound';
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

    // UI Controls State
    const [showSkeleton, setShowSkeleton] = useState(true);
    const [showControlsPanel, setShowControlsPanel] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const controlsPanelRef = useRef(null);

    // Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const audioStreamRef = useRef(null);
    const ffmpegRef = useRef(new FFmpeg());
    const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

    // Refs for logic to avoid closure staleness in callbacks
    const detectorRef = useRef(new JumpDetector());
    const gameStateRef = useRef('IDLE');
    const isPausedRef = useRef(false);
    const cameraRef = useRef(null);
    const poseRef = useRef(null);
    const timerRef = useRef(null);

    // Sync ref with state
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    // Initialize FFmpeg
    useEffect(() => {
        const loadFFmpeg = async () => {
            try {
                const ffmpeg = ffmpegRef.current;
                const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
                await ffmpeg.load({
                    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                });
                setFfmpegLoaded(true);
                console.log('FFmpeg loaded successfully');
            } catch (error) {
                console.error('Failed to load FFmpeg:', error);
            }
        };
        loadFFmpeg();
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
                document.exitFullscreen().catch(err => console.log(err));
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [gameState, isPaused]);

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

        // Only run detection logic if game is ACTIVE and not paused
        if (gameStateRef.current === 'ACTIVE' && !isPausedRef.current) {
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
            const pose = new Pose({ locateFile: (file) => `/mediapipe/pose/${file}` });

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

            // 自动进入全屏
            setTimeout(() => {
                enterFullscreen(videoWrapperRef.current);
            }, 500);
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
                setGameState('ACTIVE');
                // 启动录制
                startRecording();
            }
        }, 1000);
    };

    const enterFullscreen = (element) => {
        if (!element) return;

        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => console.log(err));
        } else if (element.webkitRequestFullscreen) { /* Safari */
            element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) { /* IE11 */
            element.msRequestFullscreen();
        }
    };

    const startRecording = async () => {
        try {
            const videoElement = webcamRef.current?.video;
            if (!videoElement || !videoElement.srcObject) {
                console.error('Video stream not available');
                return;
            }

            recordedChunksRef.current = [];
            const videoStream = videoElement.srcObject;

            // 获取麦克风音频流
            let combinedStream;
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioStreamRef.current = audioStream;

                // 合并视频轨道和音频轨道
                combinedStream = new MediaStream([
                    ...videoStream.getVideoTracks(),
                    ...audioStream.getAudioTracks()
                ]);
                console.log('Recording with audio and video');
            } catch (audioError) {
                console.warn('Could not access microphone, recording video only:', audioError);
                // 如果无法获取音频，只录制视频
                combinedStream = videoStream;
            }

            // 创建 MediaRecorder
            const options = { mimeType: 'video/webm;codecs=vp9,opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
            }

            const mediaRecorder = new MediaRecorder(combinedStream, options);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });

                // 停止音频轨道
                if (audioStreamRef.current) {
                    audioStreamRef.current.getTracks().forEach(track => track.stop());
                    audioStreamRef.current = null;
                }

                setIsRecording(false);

                // 生成文件名，包含日期和跳绳次数
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 19).replace(/:/g, '-');
                const baseFilename = `跳绳录像_${count}次_${dateStr}`;

                // 如果 FFmpeg 已加载，转换为 MP4
                if (ffmpegLoaded) {
                    try {
                        setIsConverting(true);
                        const ffmpeg = ffmpegRef.current;

                        // 写入输入文件
                        await ffmpeg.writeFile('input.webm', await fetchFile(blob));

                        // 转换为 MP4（重新编码为 H.264 和 AAC）
                        await ffmpeg.exec([
                            '-i', 'input.webm',
                            '-c:v', 'libx264',
                            '-preset', 'fast',
                            '-crf', '22',
                            '-c:a', 'aac',
                            '-b:a', '128k',
                            'output.mp4'
                        ]);

                        // 读取输出文件
                        const data = await ffmpeg.readFile('output.mp4');
                        const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
                        const url = URL.createObjectURL(mp4Blob);

                        // 下载 MP4 视频
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${baseFilename}.mp4`;
                        a.click();
                        URL.revokeObjectURL(url);

                        // 清理 FFmpeg 文件系统
                        await ffmpeg.deleteFile('input.webm');
                        await ffmpeg.deleteFile('output.mp4');

                        setIsConverting(false);
                        console.log('Video converted to MP4 successfully');
                    } catch (error) {
                        console.error('Failed to convert to MP4:', error);
                        setIsConverting(false);
                        
                        // 如果转换失败，下载原始 WebM 文件
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${baseFilename}.webm`;
                        a.click();
                        URL.revokeObjectURL(url);
                    }
                } else {
                    // FFmpeg 未加载，下载 WebM 文件
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${baseFilename}.webm`;
                    a.click();
                    URL.revokeObjectURL(url);
                    console.warn('FFmpeg not loaded, saving as WebM');
                }
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
            console.log('Recording started');
        } catch (error) {
            console.error('Failed to start recording:', error);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            console.log('Recording stopped');
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
        speak('时间到，运动结束');
        // 停止录制
        stopRecording();
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

                        {/* Immersive Controls */}
                        <div className={`immersive-controls ${showControls ? 'visible' : ''}`}>
                            <button className="control-btn pause-btn" onClick={togglePause}>
                                {isPaused ? '▶️ 继续' : '⏸️ 暂停'}
                            </button>
                            <button className="control-btn stop-btn" onClick={stopSession}>
                                停止并重置
                            </button>
                        </div>

                        {/* Fullscreen Status Indicator */}
                        <div className={`overlay-status ${isJumping ? 'jumping' : isPaused ? 'paused' : ''}`}>
                            {isPaused ? '已暂停' : (isJumping ? '跳！' : '运动中')}
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

                {/* Converting Overlay */}
                {isConverting && (
                    <div className="countdown-overlay">
                        <div className="converting-spinner"></div>
                        <div className="countdown-text" style={{ marginTop: 20 }}>正在转换为 MP4...</div>
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
