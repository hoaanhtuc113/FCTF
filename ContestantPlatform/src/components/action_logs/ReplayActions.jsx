import { useEffect, useState, useRef } from "react";
import { Application, AnimatedSprite } from "pixi.js";
import mapData from "/assets/map.png";
import characterTexture from "/assets/Warrior_Blue.png";
import challengesTexture from "/assets/Tower_Red.png";
import { CharacterManager, CharacterState } from "../map/CharacterManager";
import { ChallengeManager } from "../map/ChallengeManager";
import { MapManager } from "../map/MapManager";
import { ExplosionManager } from "../map/ExplosionManager";
import { CoinManager } from "../map/CoinManager";
import ApiHelper from "../../utils/ApiHelper";
import { BASE_URL, API_GET_ACTION_LOGS } from "../../constants/ApiConstant";
import { actionType } from "../../constants/ActionLogConstant";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const ReplayActions = () => {
    // ==============================================
    // 1. Refs and State Declarations
    // ==============================================
    const pixiAppRef = useRef(null);
    const mapManagerRef = useRef(null);
    const challengeManagerRef = useRef(null);
    const coinManagerRef = useRef(null);
    const explosionManagerRef = useRef(null);
    const charactersRef = useRef({});
    const containerRef = useRef(null);
    const replayStartTimeRef = useRef(0);

    const [logs, setLogs] = useState([]);
    const [filteredLogs, setFilteredLogs] = useState([]);
    const [isReplaying, setIsReplaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [filterMessage, setFilterMessage] = useState("");
    const [totalReplayTime, setTotalReplayTime] = useState(0);
    const [currentReplayTime, setCurrentReplayTime] = useState(0);
    const [timeoutIds, setTimeoutIds] = useState([]);
    const [intervalIds, setIntervalIds] = useState([]);
    const [pauseTime, setPauseTime] = useState(0);
    const [processedLogs, setProcessedLogs] = useState([]);
    const [replayUsers, setReplayUsers] = useState([]);
    const [actionLogsDisplay, setActionLogsDisplay] = useState([]);
    const [explosionManagerReady, setExplosionManagerReady] = useState(false);
    const [coinManagerReady, setCoinManagerReady] = useState(false);
    const [chatVisible, setChatVisible] = useState(true);
    const [speed, setSpeed] = useState(1);
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekTime, setSeekTime] = useState(0);

    const speedOptions = [1, 1.5, 2, 2.5, 3];

    // ==============================================
    // 2. Hooks (useEffect)
    // ==============================================
    useEffect(() => {
        const fetchLogs = async () => {
            const api = new ApiHelper(BASE_URL);
            try {
                const response = await api.get(API_GET_ACTION_LOGS);
                if (response.success) {
                    setLogs(response.data);
                    setFilteredLogs(response.data);
                } else {
                    console.error("Failed to fetch logs:", response.error);
                }
            } catch (error) {
                console.error("Error fetching logs:", error);
            }
        };
        fetchLogs();

        return () => {
            resetAllState();
        };
    }, []);

    useEffect(() => {
        if (!containerRef.current) return;

        const initPixiApp = async () => {
            const app = new Application();
            pixiAppRef.current = app;
            await app.init({ background: "#87CEEB", resizeTo: containerRef.current });

            if (containerRef.current) {
                while (containerRef.current.firstChild) {
                    containerRef.current.removeChild(containerRef.current.firstChild);
                }
                containerRef.current.appendChild(app.canvas);
            }

            const mapManager = new MapManager(app, mapData);
            mapManager.initialize();
            mapManagerRef.current = mapManager;

            const challengeManager = new ChallengeManager(app, mapManager.mapContainer, challengesTexture);
            challengeManager.initialize();
            challengeManagerRef.current = challengeManager;

            try {
                explosionManagerRef.current = new ExplosionManager(app, mapManager.mapContainer);
                const loaded = await explosionManagerRef.current.initialize();
                setExplosionManagerReady(loaded);
                if (!loaded) {
                    console.warn("Coin animations will not be available");
                }
            } catch (error) {
                console.error("Failed to initialize coin manager:", error);
                setExplosionManagerReady(false);
            }

            try {
                coinManagerRef.current = new CoinManager(app, mapManager.mapContainer);
                const coinLoaded = await coinManagerRef.current.initialize();
                setCoinManagerReady(coinLoaded);
                if (!coinLoaded) {
                    console.warn("Coin animations will not be available");
                }
            } catch (error) {
                console.error("Failed to initialize coin manager:", error);
                setCoinManagerReady(false);
            }

            const onWheel = (event) => {
                mapManagerRef.current?.onWheel(event);
            };
            containerRef.current.addEventListener("wheel", onWheel, { passive: false });

            return () => {
                containerRef.current?.removeEventListener("wheel", onWheel);
                app.destroy(true, { children: true });
            };
        };

        initPixiApp();
    }, [containerRef.current]);

    useEffect(() => {
        console.log("Updated currentReplayTime:", currentReplayTime,
            "Speed:", speed,
            "Calculated time:", (Date.now() - replayStartTimeRef.current) * speed);
    }, [currentReplayTime]);

    useEffect(() => {
        if (isReplaying && !isPaused) {
            const newStartTime = Date.now() - (currentReplayTime / speed);
            replayStartTimeRef.current = newStartTime;
        }
    }, [speed]);

    // ==============================================
    // 3. Utility Functions
    // ==============================================
    const formatTime = (milliseconds) => {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return [
            hours.toString().padStart(2, "0"),
            minutes.toString().padStart(2, "0"),
            seconds.toString().padStart(2, "0")
        ].join(":");
    };

    const formatDate = (isoString) => {
        try {
            // Tạo Date object và điều chỉnh theo múi giờ Việt Nam (UTC+7)
            const date = new Date(isoString);
            const timezoneOffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
            const vietnamOffset = 7 * 60 * 60000; // UTC+7 in milliseconds
            const adjustedDate = new Date(date.getTime() + timezoneOffset + vietnamOffset);

            return new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: 'Asia/Ho_Chi_Minh'
            }).format(adjustedDate);
        } catch (e) {
            console.error("Error formatting date:", e);
            return "N/A";
        }
    };

    const generateMessageFromLog = (log) => {
        const name = log.userName || `User ${log.userId}`;
        const topic = log.topicName || "một chủ đề";
        const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        const actionDate = log.actionDate || new Date().toISOString();
        const actionDetail = log.actionDetail;
        const formattedDate = formatDate(actionDate);

        let message = "";

        switch (log.actionType) {
            case actionType.ACCESS_CHALLENGE:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> ${log.actionDetail}`;
                break;
            case actionType.START_CHALLENGE:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> ${log.actionDetail}`;
                break;
            case actionType.STOP_CHALLENGE:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> ${log.actionDetail}`;
                break;
            case actionType.CORRECT_FLAG:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> ${log.actionDetail} của Topic "${topic}"`;
                break;
            case actionType.INCORRECT_FLAG:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> ${log.actionDetail} của Topic "${topic}"`;
                break;
            default:
                message = `<span class="font-bold italic">[${formattedDate}]</span>, <span class="font-bold text-red-600">${name}</span> Thực hiện hành động không xác định`;
        }

        return {
            name,
            initials,
            message,
            actionDate: formattedDate,
            actionDetail
        };
    };

    // ==============================================
    // 4. Core Replay Functions
    // ==============================================
    const resetAllState = () => {
        timeoutIds.forEach(id => clearTimeout(id));
        intervalIds.forEach(id => clearInterval(id));
        setTimeoutIds([]);
        setIntervalIds([]);

        setCurrentReplayTime(0);
        setPauseTime(0);
        setProcessedLogs([]);
        setActionLogsDisplay([]);
        setIsReplaying(false);
        setIsPaused(false);
        setSpeed(1);
        setIsSeeking(false);
        setSeekTime(0);
        replayStartTimeRef.current = 0;

        Object.values(charactersRef.current).forEach((char) => {
            if (char.currentBlinkInterval) {
                clearInterval(char.currentBlinkInterval);
            }
            char?.destroy?.();
        });
        charactersRef.current = {};

        challengeManagerRef.current?.challenges?.forEach((challenge) => {
            if (challenge.sprite) {
                challengeManagerRef.current.stopShakeEffect(challenge.sprite);
                challenge.sprite.tint = 0xFFFFFF;
            }
        });

        if (explosionManagerRef.current?.parentContainer) {
            explosionManagerRef.current.parentContainer.children.forEach(child => {
                if (child instanceof AnimatedSprite) {
                    child.destroy();
                }
            });
        }

        console.log("Replay completed, all states have been reset");
    };

    const stopAllAnimations = () => {
        timeoutIds.forEach(id => clearTimeout(id));
        intervalIds.forEach(id => clearInterval(id));
        setTimeoutIds([]);
        setIntervalIds([]);

        Object.values(charactersRef.current).forEach((character) => {
            character.stopAttack?.();
            character.pauseMovement?.();
            character.updateAnimation?.(CharacterState.IDLE);
        });

        challengeManagerRef.current?.challenges?.forEach((challenge) => {
            if (challenge.sprite) {
                challengeManagerRef.current.stopShakeEffect(challenge.sprite);
                challenge.sprite.tint = 0xFFFFFF;
            }
        });
    };

    const recreateCharactersAndActions = async (logsToRecreate) => {
        Object.values(charactersRef.current).forEach(char => char?.destroy?.());
        charactersRef.current = {};

        for (const log of logsToRecreate) {
            if (!charactersRef.current[log.userId]) {
                const characterManager = new CharacterManager(
                    pixiAppRef.current,
                    mapManagerRef.current.mapContainer,
                    characterTexture,
                    { id: log.userId, name: log.userName },
                    challengeManagerRef.current,
                    speed
                );
                await characterManager.initialize();
                charactersRef.current[log.userId] = characterManager;
            }

            const character = charactersRef.current[log.userId];
            const challengeSprite = challengeManagerRef.current.findChallengeByTopicName(log.topicName);

            if (character && challengeSprite) {
                switch (log.actionType) {
                    case actionType.ACCESS_CHALLENGE:
                    case actionType.CORRECT_FLAG:
                    case actionType.INCORRECT_FLAG:
                        character.character.position.set(
                            challengeSprite.position.x,
                            challengeSprite.position.y
                        );
                        break;
                }
            }
        }
    };

    const addActionMessage = (log) => {
        const message = generateMessageFromLog(log);
        setActionLogsDisplay(prev => {
            const updated = [...prev, message];
            return updated.slice(-20);
        });
    };

    const processLogs = (startIndex = 0, initialDelay = 0) => {
        if (!filteredLogs || filteredLogs.length === 0) return;

        timeoutIds.forEach(id => clearTimeout(id));
        intervalIds.forEach(id => clearInterval(id));

        const sortedLogs = [...filteredLogs].sort((a, b) => {
            const dateA = new Date(a.actionDate).getTime();
            const dateB = new Date(b.actionDate).getTime();
            return dateA - dateB;
        });
        const newTimeoutIds = [];
        const newIntervalIds = [];

        const startTime = Date.now() - (initialDelay / speed);
        replayStartTimeRef.current = startTime;

        const updateInterval = setInterval(() => {
            const elapsedTime = (Date.now() - startTime) * speed;
            const newTime = Math.min(elapsedTime, totalReplayTime);
            setCurrentReplayTime(newTime);

            if (newTime >= totalReplayTime) {
                clearInterval(updateInterval);
                resetAllState();
            }
        }, 100);
        newIntervalIds.push(updateInterval);

        for (let i = startIndex; i < sortedLogs.length; i++) {
            const log = sortedLogs[i];
            const delay = (i - startIndex) * (1000 / speed);

            const timeoutId = setTimeout(async () => {
                setProcessedLogs(prev => [...prev, log]);
                addActionMessage(log);

                if (!charactersRef.current[log.userId]) {
                    const characterManager = new CharacterManager(
                        pixiAppRef.current,
                        mapManagerRef.current.mapContainer,
                        characterTexture,
                        { id: log.userId, name: log.userName },
                        challengeManagerRef.current,
                        speed
                    );
                    await characterManager.initialize();
                    charactersRef.current[log.userId] = characterManager;
                }

                const character = charactersRef.current[log.userId];
                const challengeSprite = challengeManagerRef.current.findChallengeByTopicName(log.topicName);
                if (!character || !challengeSprite) return;

                const nextLog = sortedLogs[i + 1];

                switch (log.actionType) {
                    case actionType.ACCESS_CHALLENGE:
                        character.moveToChallenge(challengeSprite, () => {
                            if (
                                nextLog &&
                                nextLog.userId === log.userId &&
                                nextLog.topicName === log.topicName &&
                                nextLog.challengeName === log.challengeName
                            ) {
                                if (nextLog.actionType === actionType.CORRECT_FLAG) {
                                    if (coinManagerRef.current) {  // Check .current
                                        const coin = coinManagerRef.current.createExplosionAnimation(  // Access .current
                                            challengeSprite.position.x,
                                            challengeSprite.position.y
                                        );

                                        if (!coin) {
                                            challengeSprite.tint = 0x00FF00;
                                        }
                                    } else {
                                        challengeSprite.tint = 0x00FF00;
                                    }
                                    character.performAttack(challengeSprite, null, false);
                                } else if (nextLog.actionType === actionType.INCORRECT_FLAG) {
                                    if (explosionManagerRef.current) {  // Check .current
                                        const explosion = explosionManagerRef.current.createExplosionAnimation(  // Access .current
                                            challengeSprite.position.x,
                                            challengeSprite.position.y
                                        );

                                        if (!explosion) {
                                            challengeSprite.tint = 0x00FF00;
                                        }
                                    } else {
                                        challengeSprite.tint = 0x00FF00;
                                    }
                                    character.performAttack(challengeSprite, null, true);
                                }
                            } else {
                                character.performAttack(challengeSprite, null, true);
                            }
                        });
                        break;
                    case actionType.START_CHALLENGE:
                        character.moveToChallenge(challengeSprite, () => {
                            challengeSprite.tint = 0xFFFF00;
                            character.updateAnimation(CharacterState.ATTACK_1);

                            // Có thể thêm hiệu ứng nhấp nháy
                            const blinkInterval = setInterval(() => {
                                challengeSprite.alpha = challengeSprite.alpha === 1 ? 0.5 : 1;
                            }, 500);

                            // Lưu interval để clear sau
                            character.currentBlinkInterval = blinkInterval;
                        });
                        break;
                    case actionType.STOP_CHALLENGE:
                        character.moveToChallenge(challengeSprite, () => {
                            // Dừng hiệu ứng nhấp nháy nếu có
                            if (character.currentBlinkInterval) {
                                clearInterval(character.currentBlinkInterval);
                            }

                            // Reset về trạng thái ban đầu
                            challengeSprite.tint = 0xFFFFFF;
                            challengeSprite.alpha = 1;
                            character.updateAnimation(CharacterState.IDLE);
                        });
                        break;
                    case actionType.CORRECT_FLAG:
                        character.moveToChallenge(challengeSprite, () => {
                            character.stopAttack?.();

                            if (coinManagerRef.current) {  // Check .current
                                const coin = coinManagerRef.current.createExplosionAnimation(  // Access .current
                                    challengeSprite.position.x,
                                    challengeSprite.position.y
                                );

                                if (!coin) {
                                    challengeSprite.tint = 0x00FF00;
                                }
                            } else {
                                challengeSprite.tint = 0x00FF00;
                            }
                        });
                        break;
                    case actionType.INCORRECT_FLAG:
                        character.moveToChallenge(challengeSprite, () => {
                            if (explosionManagerRef.current) {  // Check .current
                                const explosion = explosionManagerRef.current.createExplosionAnimation(  // Access .current
                                    challengeSprite.position.x,
                                    challengeSprite.position.y
                                );

                                if (!explosion) {
                                    challengeSprite.tint = 0x00FF00;
                                }
                            } else {
                                challengeSprite.tint = 0x00FF00;
                            }
                            character.performAttack(challengeSprite, null, true);
                        });
                        break;
                    default:
                        console.warn(`Unhandled actionType: ${log.actionType}`);
                }
            }, delay);

            newTimeoutIds.push(timeoutId);
        }

        const endTimeout = setTimeout(() => {
            resetAllState();
            stopAllAnimations();
            setCurrentReplayTime(0);
        }, (sortedLogs.length - startIndex) * (1000 / speed));

        newTimeoutIds.push(endTimeout);
        setTimeoutIds(newTimeoutIds);
        setIntervalIds(newIntervalIds);
    };

    // ==============================================
    // 5. Playback Control Functions
    // ==============================================
    const replayLogs = () => {
        if (!filteredLogs || filteredLogs.length === 0) return;
        resetAllState();

        setIsReplaying(true);
        replayStartTimeRef.current = Date.now();
        processLogs();
    };

    const pauseReplay = () => {
        stopAllAnimations();
        setIsPaused(true);
        setPauseTime(currentReplayTime);

        if (isSeeking) {
            setIsSeeking(false);
        }
    };

    const resumeReplay = () => {
        if (!filteredLogs || filteredLogs.length === 0) return;

        setIsReplaying(true);
        setIsPaused(false);

        const newStartTime = Date.now() - (pauseTime / speed);
        replayStartTimeRef.current = newStartTime;

        Object.values(charactersRef.current).forEach(character => {
            character.resumeMovement?.();
            character.setSpeed(speed);

            if (character.currentAnimation) {
                character.updateAnimation(character.currentAnimation);
            }

            if (character.isAttacking && character.activeChallenge) {
                character.performAttack(character.activeChallenge, null, { shake: true });
            }

            if (character.isAttacking) {
                character.resumeAttack?.();
            }
        });

        const startIndex = Math.floor(pauseTime / (1000 / speed));
        processLogs(startIndex, pauseTime);
    };

    const togglePlayPause = () => {
        if (isReplaying) {
            if (isPaused) {
                resumeReplay();
            } else {
                pauseReplay();
            }
        } else {
            replayLogs();
        }
    };

    const handleSeek = async () => {
        if (!isSeeking) return;
        const targetTime = seekTime;

        setIsSeeking(false);
        stopAllAnimations();
        setCurrentReplayTime(targetTime);

        const sortedLogs = [...filteredLogs].sort((a, b) => new Date(a.actionDate) - new Date(b.actionDate));
        let accumulatedTime = 0;
        const passedLogs = [];

        for (let i = 0; i < sortedLogs.length; i++) {
            if (accumulatedTime > targetTime) break;
            passedLogs.push(sortedLogs[i]);
            accumulatedTime += (1000 / speed);
        }

        Object.values(charactersRef.current).forEach(char => char?.destroy?.());
        charactersRef.current = {};
        await recreateCharactersAndActions(passedLogs);

        setProcessedLogs(passedLogs);
        setActionLogsDisplay(passedLogs.slice(-20).map(log => generateMessageFromLog(log)));

        if (!isPaused) {
            let startIndex = passedLogs.length;
            const newStartTime = Date.now() - (targetTime / speed);
            replayStartTimeRef.current = newStartTime;
            processLogs(startIndex, targetTime);
        }
    };

    const handleSpeedChange = () => {
        const currentIndex = speedOptions.indexOf(speed);
        const nextIndex = (currentIndex + 1) % speedOptions.length;
        const newSpeed = speedOptions[nextIndex];

        if (isReplaying) {
            const currentTime = isSeeking ? seekTime : currentReplayTime;
            stopAllAnimations();

            Object.values(charactersRef.current).forEach((char) => {
                char.setSpeed(newSpeed);
            });
            const newStartTime = Date.now() - (currentTime / newSpeed);
            replayStartTimeRef.current = newStartTime;

            if (!isPaused) {
                const startIndex = Math.floor(currentTime / (1000 / newSpeed));
                processLogs(startIndex, currentTime);
            }

            if (isSeeking) {
                setSeekTime(currentTime);
            }
        }

        setSpeed(newSpeed);
    };

    // ==============================================
    // 6. Filter and Data Handling
    // ==============================================
    const handleFilterLogs = () => {
        if (!startDate || !endDate) {
            setFilterMessage("Please select both start and end dates.");
            return;
        }

        resetAllState();

        const utcStartDate = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000);
        const utcEndDate = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000);

        const filtered = logs.filter((log) => {
            try {
                const logDate = new Date(log.actionDate);
                if (isNaN(logDate.getTime())) return false;

                // Chuyển logDate về UTC
                const utcLogDate = new Date(logDate.getTime() - logDate.getTimezoneOffset() * 60000);

                return utcLogDate >= utcStartDate && utcLogDate <= utcEndDate;
            } catch (e) {
                console.error("Error processing log date:", e);
                return false;
            }
        });

        const sortedFiltered = filtered.sort((a, b) => new Date(a.actionDate) - new Date(b.actionDate));
        setFilteredLogs(sortedFiltered);

        const users = Array.from(new Set(sortedFiltered.map(log => log.userName)));
        setReplayUsers(users);

        if (sortedFiltered.length > 0) {
            setFilterMessage(`Found ${sortedFiltered.length} logs in the selected time range.`);
            const replayTime = sortedFiltered.length * 1000;
            setTotalReplayTime(replayTime);
            console.log("Total Replay Time:", formatTime(replayTime));
        } else {
            setFilterMessage("No logs found in the selected time range.");
            setTotalReplayTime(0);
        }
    };

    // ==============================================
    // 7. Render
    // ==============================================
    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <h1 className="text-2xl font-bold text-center mb-4">Replay Actions</h1>
            <div className="mb-4 text-center">
                <div className="flex justify-center items-center space-x-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Start Date</label>
                        <DatePicker
                            selected={startDate}
                            onChange={(date) => setStartDate(date)}
                            showTimeSelect
                            dateFormat="Pp"
                            className="border rounded-md p-2"
                            timeIntervals={15}
                            timeCaption="Time"
                            timeZone="Asia/Ho_Chi_Minh"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">End Date</label>
                        <DatePicker
                            selected={endDate}
                            onChange={(date) => setEndDate(date)}
                            showTimeSelect
                            dateFormat="Pp"
                            className="border rounded-md p-2"
                            timeIntervals={15}
                            timeCaption="Time"
                            timeZone="Asia/Ho_Chi_Minh"
                        />
                    </div>
                    <button
                        onClick={handleFilterLogs}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                        Views
                    </button>
                </div>
                {filterMessage && (
                    <p className="text-sm text-gray-700 mt-2">{filterMessage}</p>
                )}
                {replayUsers.length > 0 && (
                    <div className="mt-2 text-sm text-gray-800">
                        <strong>Đang phát lại các thí sinh:</strong>{" "}
                        {replayUsers.map((name, index) => (
                            <span key={index} className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-700 mx-1">
                                {name}
                            </span>
                        ))}
                    </div>
                )}
                <span className="text-sm text-gray-600">Total Replay Time: {formatTime(totalReplayTime)}</span>
                <br />
                <button
                    onClick={togglePlayPause}
                    disabled={!startDate || !endDate}
                    className={`px-4 py-2 rounded-lg text-white ${!startDate || !endDate
                        ? "bg-gray-500 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600"
                        }`}
                >
                    {isReplaying ? (
                        isPaused ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        )
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    )}
                </button>
            </div>
            {isReplaying && (
                <div className="mt-4 px-8">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={togglePlayPause}
                            className="text-gray-700 hover:text-blue-600"
                        >
                            {isPaused ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            )}
                        </button>

                        <div className="flex-1 flex items-center gap-2">
                            <input
                                type="range"
                                min="0"
                                max={totalReplayTime}
                                value={isSeeking ? seekTime : (isReplaying ? currentReplayTime : 0)}
                                onChange={(e) => {
                                    const newSeekTime = Number(e.target.value);
                                    setSeekTime(newSeekTime);
                                    setCurrentReplayTime(newSeekTime);
                                    setIsSeeking(true);
                                }}
                                onMouseUp={handleSeek}
                                onTouchEnd={handleSeek}
                                className="flex-1"
                            />
                            <span className="text-xs text-gray-600 whitespace-nowrap">
                                {formatTime(isSeeking ? seekTime : currentReplayTime)} / {formatTime(totalReplayTime)}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSpeedChange}
                                className="bg-gray-200 hover:bg-gray-300 text-xs px-2 py-1 rounded border border-gray-400 whitespace-nowrap flex items-center gap-1"
                            >
                                <span>⏩</span>
                                <span className="font-medium">{speed}x</span>
                                <span className="text-xs opacity-70">
                                    (Next: {speedOptions[(speedOptions.indexOf(speed) + 1) % speedOptions.length]}x)
                                </span>
                            </button>
                        </div>
                    </div>
                    <br />
                </div>
            )}
            <div ref={containerRef} className="w-full h-[600px] bg-gray-200"></div>
            {isReplaying && (
                <div className="fixed top-4 right-4 bg-blue-600 text-white text-sm font-semibold px-3 py-1 rounded shadow-lg z-50 transition-all animate-pulse">
                    🚀 {speed}x Speed
                </div>
            )}

            <button
                onClick={() => setChatVisible(prev => !prev)}
                className="fixed bottom-6 right-6 bg-blue-600 text-white rounded-full shadow-md w-10 h-10 flex items-center justify-center z-50"
                title={chatVisible ? "Ẩn khung chat" : "Hiện khung chat"}
            >
                {chatVisible ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                )}
            </button>
            {isReplaying && chatVisible && (
                <div className="fixed bottom-6 right-20 w-80 max-h-64 bg-white border border-gray-300 rounded-lg shadow-lg overflow-hidden z-40 text-sm">
                    <div className="bg-blue-600 text-white px-3 py-2 font-semibold flex justify-between items-center">
                        🎯 Hành động thí sinh
                    </div>
                    <div className="p-2 space-y-1 overflow-y-auto max-h-52 custom-scrollbar">
                        {actionLogsDisplay.map((msg, index) => (
                            <div key={index} className="flex items-start gap-2 bg-gray-50 px-2 py-1 rounded shadow-sm border border-gray-100">
                                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-400 text-white text-xs flex items-center justify-center font-bold">
                                    {msg.initials}
                                </div>
                                <div
                                    className="text-gray-700"
                                    dangerouslySetInnerHTML={{ __html: msg.message }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReplayActions;