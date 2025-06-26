import React, { useEffect, useState } from "react";
import { FaLock, FaMedal, FaTrophy, FaUsers } from "react-icons/fa";
import Swal from "sweetalert2";
import { API_TEAM_PERFORMANCE, API_TEAM_POINT, API_USER_PROFILE, BASE_URL } from "../../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../../constants/LocalStorageKey";
import ApiHelper from "../../utils/ApiHelper";
import PerformanceChart from "./PerformanceChart";

const UserProfile = () => {
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [userInfo, setUserInfo] = useState({});
    const [teamPointInfo, setTeamPointInfo] = useState({
        members: []
    });
    const [teamPerformance, setTeamPerformance] = useState({
        data: []
    });
    const [passwordData, setPasswordData] = useState({
        oldPassword: "",
        newPassword: "",
        confirmPassword: ""
    });
    const [finishPercent, setFinishPercent] = useState(75);

    const [passwordStrength, setPasswordStrength] = useState("");
    const [passwordCriteria, setPasswordCriteria] = useState({
        minLength: false,
        uppercase: false,
        lowercase: false,
        number: false,
        specialChar: false
    });

    const validatePassword = (password) => {
        const criteria = {
            minLength: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /\d/.test(password),
            specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
        };
        setPasswordCriteria(criteria);

        const strength =
            Object.values(criteria).filter(Boolean).length >= 4
                ? "Strong"
                : "Weak";
        setPasswordStrength(strength);
    };

    const handlePasswordChange = (e) => {
        const { name, value } = e.target;
        setPasswordData((prev) => ({ ...prev, [name]: value }));

        if (name === "newPassword") {
            validatePassword(value);
        }
    };

    useEffect(() => {
        fetchUserInfo();
        fetchTeamPointInfo();
        fetchPerformaceData();
    }, [])

    let fetchUserInfo = async () => {
        const api = new ApiHelper(BASE_URL);
        try {
            const response = await api.get(`${API_USER_PROFILE}`);
            console.log(response)
            if (response.data) {
                setUserInfo(response.data);
            } else {
                console.error("Failed to fetch hints:", response.error || "Unknown error");
            }
        } catch (error) {
            console.error("Error fetching UserInfo:", error);
        }
    }

    let fetchTeamPointInfo = async () => {
        const api = new ApiHelper(BASE_URL);
        try {
            const response = await api.get(`${API_TEAM_POINT}`);
            if (response.data) {
                setTeamPointInfo(response.data);
                setFinishPercent((response.data.score / response.data.challengeTotalScore * 100).toFixed(2));
            } else {
                console.error("Failed to fetch hints:", response.error || "Unknown error");
            }
        } catch (error) {
            console.error("Error fetching TeamPointInfo:", error);
        }
    }

    let fetchPerformaceData = async () => {
        const api = new ApiHelper(BASE_URL);
        try {
            const response = await api.get(`${API_TEAM_PERFORMANCE}`);
            console.log(response);
            if (response.data) {
                setTeamPerformance(response)
            } else {
                console.error("Failed to fetch hints:", response.error || "Unknown error");
            }
        } catch (error) {
            console.error("Error fetching TeamPointInfo:", error);
        }
    }

    const achievements = [
        { id: 1, title: "First Blood", description: "First to solve a challenge", type: "gold" },
        { id: 2, title: "Speed Demon", description: "Completed 5 challenges in 1 hour", type: "silver" },
        { id: 3, title: "Master Hacker", description: "Solved all web challenges", type: "bronze" },
        { id: 4, title: "Master Hacker", description: "Solved all web challenges", type: "bronze" },
        { id: 5, title: "Master Hacker", description: "Solved all web challenges", type: "bronze" },
        { id: 6, title: "Master Hacker", description: "Solved all web challenges", type: "bronze" }
    ];

    const recentChallenges = [
        { name: "Web Exploit 101", difficulty: "Easy", completed: true, progress: 100 },
        { name: "Binary Analysis", difficulty: "Hard", completed: false, progress: 75 },
        { name: "Cryptography Challenge", difficulty: "Medium", completed: true, progress: 100 }
    ];
    const handleChangePassword = async () => {
        const { oldPassword, newPassword, confirmPassword } = passwordData;
        const generatedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        const api = new ApiHelper(BASE_URL);
        // Basic validation
        if (!oldPassword || !newPassword || !confirmPassword) {
            showModalMessage("All fields are required!", "error");
            return;
        }
    
        if (newPassword !== confirmPassword) {
            showModalMessage("New password and confirm password do not match!", "error");
            return;
        }
    
        if (newPassword.length < 8) {
            showModalMessage("New password must be at least 8 characters long.", "error");
            return;
        }
    
        try {
            const response = await api.patch(`${API_USER_PROFILE}`, {
                params: {
                    password: newPassword,
                    confirm: oldPassword,
                },
            });
        
            if (response.success) {
                showModalMessage("Password updated successfully!", "success");
                setShowPasswordModal(false);
            } else {
                showModalMessage(response.errors || "Unexpected error occurred.", "error");
            }
        } catch (error) {
            if (error.response) {
                const { status, data } = error.response;
                console.log(status, data)
                if (status === 400 && data && data.errors) {
                    switch (data.errors) {
                        case "Both 'password' and 'confirm' fields are required.":
                            showModalMessage("Please provide both current and new passwords.", "error");
                            break;
                            case "Password does not meet the required criteria.":
                                showModalMessage(
                                    "Your new password doesn't match the required criteria. " +
                                    "It must contain at least one letter (uppercase or lowercase), " +
                                    "at least one digit, at least one special character (@$!%*#?&), " +
                                    "and be at least 8 characters long.",
                                    "error"
                                );
                                break;
                        case "Password and confirm must not be the same.":
                            showModalMessage("Password and old password must not be the same.", "error");
                            break;
                        case "Authentication failed.":
                            showModalMessage("Authentication failed. Please log in again.", "error");
                            break;
                        default:
                            showModalMessage(data.errors.confirm || "An unexpected error occurred.", "error");
                    }
                } else {
                    showModalMessage("An unexpected error occurred. Please try again.", "error");
                }
            } else {
                showModalMessage("A network error occurred. Please check your connection.", "error");
            }
        }
    };
    
    // Utility function to display SweetAlert2 modal messages
    const showModalMessage = (message, icon = "info") => {
        Swal.fire({
            title: icon === "success" ? "Success!" : "Error!",
            text: message,
            icon: icon,
            confirmButtonText: "OK",
        });
    };

    return (
        <div className="min-h-screen bg-gray-900 py-8 px-2 flex flex-col items-center transition-colors duration-300">
            <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* LEFT: Profile Card */}
                <div className="col-span-1 flex flex-col gap-6">
                    <div className="bg-gray-800 rounded-2xl shadow-lg p-8 flex flex-col items-center border border-gray-800 relative">
                        <div className="absolute top-4 right-4 cursor-pointer text-gray-400 hover:text-orange-500 transition"><svg width="20" height="20" fill="none" stroke="currentColor"><path d="M12 4v1m0 10v1m6-6h-1M5 12H4m1.293-6.707l.707.707M16.293 16.293l.707.707M16.293 7.707l.707-.707M7.707 16.293l-.707.707" strokeWidth="2" strokeLinecap="round"/></svg></div>
                        <div className="relative w-28 h-28 mb-3">
                            <img
                                src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcwhPhFEnyOzxoKysVzNiMn245tFGSEBFavA&s"
                                alt="Profile"
                                className="w-full h-full object-cover rounded-full border-4 border-gray-700 shadow"
                            />
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-2xl font-bold text-white">{userInfo.username || 'Username'}</h2>
                            <span className="ml-1 text-xs bg-[#f44336] text-white px-2 py-0.5 rounded font-semibold">🇻🇳</span>
                        </div>
                        <div className="text-gray-300 text-sm mb-1">{userInfo.email || 'Add your email'}</div>
                        <div className="text-gray-400 text-sm mb-2">{userInfo.team || 'No team'}</div>
                        <div className="text-gray-500 text-xs mb-4">Vietnam</div>
                        <button
                            onClick={() => setShowPasswordModal(true)}
                            className="flex items-center gap-2 text-orange-500 hover:text-orange-600 font-semibold border border-orange-400 px-4 py-2 rounded-lg transition-all mt-2"
                        >
                            <FaLock /> Change password
                        </button>
                        {/* Profile Completion Progress
                        <div className="w-full mt-6">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Profile completion</span>
                                <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{finishPercent || 0}%</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${finishPercent || 0}%` }}></div>
                            </div>
                        </div> */}
                    </div>
                </div>

                {/* RIGHT: Info Cards */}
                <div className="col-span-2 flex flex-col gap-8">
                    {/* Team Ranking & Performance */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Team Ranking */}
                        <div className="bg-gray-800 rounded-2xl shadow p-6 border border-gray-800 flex flex-col gap-2">
                            <div className="flex items-center gap-2 mb-2">
                                <FaTrophy className="text-yellow-500 text-2xl" />
                                <span className="font-semibold text-white">Team Ranking</span>
                            </div>
                            <div className="text-4xl font-extrabold text-orange-600 mb-1">{teamPointInfo.place}</div>
                            <div className="text-gray-300 mb-2">Score: <span className="font-bold">{teamPointInfo.score}</span></div>
                            <div className="w-full mt-2">
                                <div className="bg-gray-700 rounded-full h-2 relative">
                                    <div
                                        className="bg-orange-400 h-2 rounded-full"
                                        style={{ width: `${finishPercent}%` }}
                                    ></div>
                                    <span className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full text-xs text-gray-200 font-medium">
                                        Finished: {finishPercent}%
                                    </span>
                                </div>
                            </div>
                        </div>
                        {/* Performance Chart */}
                        <div className="bg-gray-800 rounded-2xl shadow p-6 border border-gray-800 flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                                <FaTrophy className="text-orange-400 text-2xl" />
                                <span className="font-semibold text-white">Team Performance</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center min-h-[120px]">
                                <PerformanceChart data={teamPerformance.data} />
                            </div>
                        </div>
                    </div>
                    {/* Team Members */}
                    <div className="bg-gray-800 rounded-2xl shadow p-6 border border-gray-800">
                        <div className="flex items-center gap-2 mb-4">
                            <FaUsers className="text-orange-400 text-2xl" />
                            <span className="text-xl font-bold text-white">Team Members</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border border-orange-400 rounded-lg overflow-hidden">
                                <thead>
                                    <tr className="bg-gray-900 text-orange-300">
                                        <th className="p-3 text-left">Name</th>
                                        <th className="p-3 text-left">Email</th>
                                        <th className="p-3 text-left">Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teamPointInfo.members.map((member, index) => (
                                        <tr key={index} className="border-t border-orange-400 hover:bg-gray-700 text-gray-200">
                                            <td className="p-3">{member.name}</td>
                                            <td className="p-3">{member.email}</td>
                                            <td className="p-3">{member.score}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {/* Achievements & Recent Challenges */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Achievements */}
                        <div className="bg-gray-800 rounded-2xl shadow p-6 border border-gray-800">
                            <div className="flex items-center gap-2 mb-2">
                                <FaMedal className="text-orange-400 text-2xl" />
                                <span className="font-semibold text-white">Achievements</span>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {achievements.map((achievement) => (
                                    <div key={achievement.id} className="flex items-center gap-3">
                                        <FaMedal className={`text-2xl ${achievement.type === "gold" ? "text-yellow-500" : achievement.type === "silver" ? "text-gray-400" : "text-yellow-700"}`} />
                                        <div>
                                            <h3 className="font-semibold text-white">{achievement.title}</h3>
                                            <p className="text-xs text-gray-300">{achievement.description}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Recent Challenges */}
                        <div className="bg-gray-800 rounded-2xl shadow p-6 border border-gray-800">
                            <div className="flex items-center gap-2 mb-2">
                                <FaTrophy className="text-orange-400 text-2xl" />
                                <span className="font-semibold text-white">Recent Challenges</span>
                            </div>
                            <div className="space-y-4">
                                {teamPerformance.data.map((challenge, index) => (
                                    <div key={index} className="border-b pb-4 last:border-b-0 border-gray-700">
                                        <div className="flex justify-between items-center">
                                            <h3 className="font-semibold text-white">{challenge.challenge.name}</h3>
                                            <span className={`px-2 py-1 rounded-full text-xs ${challenge.type === "correct" ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}`}>
                                                {challenge.type.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="mt-2 bg-gray-700 rounded-full h-2">
                                            <div
                                                className={`h-2 rounded-full ${challenge.type === "correct" ? "bg-green-500" : "bg-orange-400"}`}
                                                style={{ width: `${challenge.progress}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Password Change Modal */}
            {showPasswordModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-md shadow-xl border border-orange-400">
                        <h2 className="text-xl font-bold text-orange-500 mb-4 flex items-center gap-2"><FaLock /> Đổi mật khẩu</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">Mật khẩu cũ</label>
                                <input
                                    type="password"
                                    className="w-full rounded-md border border-orange-400 p-2 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-gray-900 text-white"
                                    value={passwordData.oldPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">Mật khẩu mới</label>
                                <input
                                    type="password"
                                    className="w-full rounded-md border border-orange-400 p-2 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-gray-900 text-white"
                                    value={passwordData.newPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">Xác nhận mật khẩu mới</label>
                                <input
                                    type="password"
                                    className="w-full rounded-md border border-orange-400 p-2 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-gray-900 text-white"
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-4">
                                <button
                                    className="px-4 py-2 bg-gray-700 text-gray-200 rounded-md hover:bg-gray-600"
                                    onClick={() => setShowPasswordModal(false)}
                                >
                                    Hủy
                                </button>
                                <button
                                    className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 font-semibold"
                                    onClick={handleChangePassword}
                                >
                                    Đổi mật khẩu
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserProfile;