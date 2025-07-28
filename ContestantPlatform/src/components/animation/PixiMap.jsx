import { useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import mapData from "/assets/map.png";
import characterTexture from "/assets/Warrior_Blue.png";
import challengesTexture from "/assets/Tower_Red.png";
import { useUser } from '../contexts/UserContext';
import { MapManager } from "./MapManager.jsx";
import { ChallengeManager } from "./ChallengeManager.jsx";
import { CharacterManager, CharacterState } from "./CharacterManager.jsx";
import { io } from "socket.io-client";
import { BASE_URL } from "../../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../../constants/LocalStorageKey";
import { actionType } from "../../constants/ActionLogConstant";

const PixiMap = () => {
    const pixiContainer = useRef(null);
    const appRef = useRef(null);
    const { user } = useUser();
    const mapManagerRef = useRef(null);
    const challengeManagerRef = useRef(null);
    const characterManagerRef = useRef(null);
    const otherCharactersRef = useRef({});
    const positionUpdateIntervalRef = useRef(null);
    const initialDataRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const socketRef = useRef(null);

    // 1. Khởi tạo PixiJS Application và các managers
    useEffect(() => {
        if (!pixiContainer.current || !user || !user.id || !user.name || appRef.current) return;

        (async () => {
            try {
                const app = new Application();
                appRef.current = app;
                await app.init({ background: "#87CEEB", resizeTo: pixiContainer.current });

                // Clear container trước khi thêm canvas mới
                while (pixiContainer.current.firstChild) {
                    pixiContainer.current.removeChild(pixiContainer.current.firstChild);
                }
                pixiContainer.current.appendChild(app.canvas);

                // Khởi tạo MapManager
                mapManagerRef.current = new MapManager(app, mapData);
                const mapContainer = await mapManagerRef.current.initialize();
                if (!mapContainer) {
                    throw new Error("Failed to initialize map container");
                }

                // Khởi tạo ChallengeManager
                challengeManagerRef.current = new ChallengeManager(app, mapContainer, challengesTexture);
                challengeManagerRef.current.onChallengeClicked = (challengeSprite) => {
                    characterManagerRef.current?.moveToChallenge(challengeSprite);
                };
                await challengeManagerRef.current.initialize();

                // Khởi tạo CharacterManager (nhân vật chính)
                const initialPosition = JSON.parse(localStorage.getItem("characterPosition")) || {
                    x: Math.floor(Math.random() * 600 - 300),
                    y: Math.floor(Math.random() * 400 - 200)
                };

                characterManagerRef.current = new CharacterManager(
                    app,
                    mapContainer,
                    characterTexture,
                    {
                        ...user,
                        x: initialPosition.x,
                        y: initialPosition.y
                    },
                    challengeManagerRef.current
                );
                await characterManagerRef.current.initialize();

                // Thêm sự kiện zoom cho map
                const onWheel = (event) => {
                    mapManagerRef.current.onWheel(event);
                };
                pixiContainer.current.addEventListener("wheel", onWheel, { passive: false });

                // Đánh dấu đã khởi tạo xong
                setIsReady(true);

                return () => {
                    pixiContainer.current?.removeEventListener("wheel", onWheel);
                    mapManagerRef.current?.destroy();
                    challengeManagerRef.current?.destroy();
                    characterManagerRef.current?.destroy();
                    appRef.current?.destroy(true);
                };
            } catch (error) {
                console.error("Initialization error:", error);
            }
        })();
    }, [user]);

    // 2. Thiết lập socket connection và xử lý dữ liệu
    useEffect(() => {
        if (!isReady) return;

        // const socket = io(BASE_URL, {
        //     auth: { token: localStorage.getItem(ACCESS_TOKEN_KEY) },
        //     reconnection: true,
        //     reconnectionAttempts: 5,
        //     reconnectionDelay: 2000
        // });
        // socketRef.current = socket;

        // // Xử lý dữ liệu ban đầu từ server
        // socket.on("initial-data", (data) => {
        //     handleInitialData(data);
        // });

        // // Xử lý các sự kiện real-time
        // socket.on("all-characters", (data) => {
        //     data.characters.forEach(addOtherCharacter);
        // });

        // socket.on("add-character-to-map", addOtherCharacter);

        // socket.on("remove-character-from-map", ({ id }) => {
        //     removeOtherCharacter(id);
        // });

        // socket.on("update-character-position", ({ id, position, animation }) => {
        //     updateCharacterPosition(id, position, animation);
        // });

        // socket.on("update-challenge-positions", (data) => {
        //     updateChallengePositions(data.positions);
        // });

        // socket.on("challenge-selected", handleLogs);

        // // Gửi yêu cầu dữ liệu ban đầu
        // socket.emit("request-initial-data");

        // Thiết lập interval cập nhật vị trí nhân vật chính
        positionUpdateIntervalRef.current = setInterval(() => {
            updateMainCharacterPosition();
        }, 100);

        return () => {
            clearInterval(positionUpdateIntervalRef.current);
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [isReady]);

    // 3. Xử lý dữ liệu đã nhận trước khi ready (nếu có)
    useEffect(() => {
        if (isReady && initialDataRef.current) {
            handleInitialData(initialDataRef.current);
            initialDataRef.current = null;
        }
    }, [isReady]);

    // ========== Các hàm xử lý ==========

    const handleInitialData = (data) => {
        if (!isReady) {
            initialDataRef.current = data;
            return;
        }

        // Xử lý characters
        data.characters?.forEach(addOtherCharacter);

        // Xử lý challenges
        if (data.challenges) {
            updateChallengePositions(data.challenges);
        }

        // Xử lý logs
        if (data.logs) {
            handleLogs(data.logs);
        }
    };

    const addOtherCharacter = (character) => {
        if (!character?.id || character.id === user?.id || otherCharactersRef.current[character.id]) return;

        if (!mapManagerRef.current?.mapContainer) {
            console.warn("Map container not ready");
            return;
        }

        const otherCharacter = new CharacterManager(
            appRef.current,
            mapManagerRef.current.mapContainer,
            characterTexture,
            character,
            challengeManagerRef.current
        );

        otherCharacter.initialize()
            .then(() => {
                otherCharactersRef.current[character.id] = otherCharacter;
                if (character.position) {
                    otherCharacter.updatePosition(character.position);
                }
            })
            .catch(error => {
                console.error("Failed to initialize character:", error);
            });
    };

    const removeOtherCharacter = (id) => {
        if (!otherCharactersRef.current[id]) return;
        otherCharactersRef.current[id].destroy();
        delete otherCharactersRef.current[id];
    };

    const updateCharacterPosition = (id, position, animation) => {
        if (!otherCharactersRef.current[id]) return;
        otherCharactersRef.current[id].updatePosition(position);
        otherCharactersRef.current[id].updateAnimation(animation);
    };

    const updateChallengePositions = (positions) => {
        if (!challengeManagerRef.current) return;

        positions.forEach((position) => {
            const challenge = challengeManagerRef.current.challenges.find(
                (c) => c.challengeId === position.id
            );
            if (challenge) {
                challenge.sprite.position.set(position.x, position.y);
            }
        });
    };

    const updateMainCharacterPosition = () => {
        if (!characterManagerRef.current?.character || !socketRef.current?.connected) return;

        const newPosition = {
            x: characterManagerRef.current.character.x,
            y: characterManagerRef.current.character.y
        };
        const newAnimationState = characterManagerRef.current.currentAnimation;

        const prevPosition = JSON.parse(localStorage.getItem("characterPosition"));
        const prevAnimation = localStorage.getItem("characterAnimation");

        if (
            !prevPosition ||
            prevPosition.x !== newPosition.x ||
            prevPosition.y !== newPosition.y ||
            prevAnimation !== newAnimationState
        ) {
            socketRef.current.emit("update-character-position", {
                userId: user?.id,
                position: newPosition,
                animation: newAnimationState
            });
            localStorage.setItem("characterPosition", JSON.stringify(newPosition));
            localStorage.setItem("characterAnimation", newAnimationState);
        }
    };

    const handleLogs = (newLogs) => {
        if (!newLogs || !challengeManagerRef.current || !characterManagerRef.current) {
            console.warn("Invalid logs or missing references");
            return;
        }

        const filteredLogs = Array.isArray(newLogs)
            ? newLogs.filter(log => log.userId)
            : newLogs.userId ? [newLogs] : [];

        if (filteredLogs.length === 0) {
            console.warn("No relevant logs for the current user");
            return;
        }

        // Reset các hiệu ứng trước khi xử lý logs mới
        challengeManagerRef.current.challenges.forEach(challenge => {
            challengeManagerRef.current.stopShakeEffect(challenge.sprite);
        });

        filteredLogs.forEach((log) => {
            if (!log.topicName || log.topicName === "Null" || log.topicName === "None") return;

            const targetCharacter = log.userId === user?.id
                ? characterManagerRef.current
                : otherCharactersRef.current[log.userId];

            if (!targetCharacter) return;

            const challengeSprite = challengeManagerRef.current.findChallengeByTopicName(log.topicName);
            if (!challengeSprite) return;

            const relatedLogs = filteredLogs.filter(l => l.userId === log.userId);
            if (relatedLogs.length === 0) return;

            const accessChallenge = relatedLogs.some(l => l.actionType === actionType.ACCESS_CHALLENGE);
            const correctFlag = relatedLogs.some(l => l.actionType === actionType.CORRECT_FLAG);
            const incorrectFlag = relatedLogs.some(l => l.actionType === actionType.INCORRECT_FLAG);

            if (accessChallenge) {
                targetCharacter.moveToChallenge(challengeSprite, () => {
                    const isChallengeSolved = relatedLogs.some(
                        l => l.topicName === log.topicName && l.actionType === actionType.CORRECT_FLAG
                    );
                    if (!isChallengeSolved) {
                        targetCharacter.performAttack(challengeSprite);
                    }
                });
            } else if (correctFlag) {
                targetCharacter.moveToChallenge(challengeSprite, () => {
                    targetCharacter.stopAttack?.();
                });
            } else if (incorrectFlag) {
                targetCharacter.moveToChallenge(challengeSprite, () => {
                    targetCharacter.stopAttack?.();
                    setTimeout(() => {
                        targetCharacter.performAttack(challengeSprite);
                    }, 3000);
                });
            }
        });
    };

    if (!user) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-xl">Loading map...</div>
            </div>
        );
    }

    return <div ref={pixiContainer} className="w-full h-full overflow-hidden" />;
};

export default PixiMap;