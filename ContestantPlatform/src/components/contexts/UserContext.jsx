import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { BASE_URL, USER_DETAILS } from "../../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../../constants/LocalStorageKey";

const UserContext = createContext();

export const UserProvider = ({ children }) => {
    const [user, setUser] = useState();
    const socketRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const initializeUser = async () => {
            const token = localStorage.getItem(ACCESS_TOKEN_KEY);
            if (!token) return;

            try {
                const response = await fetch(`${BASE_URL}${USER_DETAILS}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const userData = await response.json();
                    setUser(userData);
                } else {
                    console.error("Failed to fetch user details:", response.statusText);
                    localStorage.removeItem(ACCESS_TOKEN_KEY);
                    setUser(null);
                }
            } catch (error) {
                console.error("An error occurred while fetching user details:", error);
                localStorage.removeItem(ACCESS_TOKEN_KEY);
                setUser(null);
            }
        };

        initializeUser();
    }, []);

    // useEffect(() => {
    //     if (!user || user.id === 'temp') return;

    //     const socket = io(BASE_URL, {
    //         auth: { token: localStorage.getItem(ACCESS_TOKEN_KEY) },
    //         reconnection: true
    //     });
    //     socketRef.current = socket;

    //     socket.emit("login", {
    //         id: user.id,
    //         name: user.name,
    //         team: user.team || "No team",
    //         position: JSON.parse(localStorage.getItem("characterPosition")) || {
    //             x: Math.floor(Math.random() * 600 - 300),
    //             y: Math.floor(Math.random() * 400 - 200)
    //         }
    //     });

    //     socket.on("login-success", (data) => {
    //         console.log("Login confirmed by server:", data);
    //     });

    //     socket.on("force-logout", (data) => {
    //         alert(data.message);
    //         logout();
    //         navigate('/login');
    //     });
    // }, [user]);

    const login = (userData) => {
        localStorage.setItem(ACCESS_TOKEN_KEY, userData.token);
        const user = {
            id: userData.id,
            name: userData.name,
            team: userData.team?.teamName || "No team"
        };
        setUser(user);
    };

    const logout = () => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem("characterPosition");
        localStorage.removeItem("characterAnimation");
        localStorage.removeItem("charactersOnMap");
        setUser(null);
    };

    return (
        <UserContext.Provider value={{ user, login, logout, isAuthenticated: !!user && user.id !== 'temp' }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => useContext(UserContext);