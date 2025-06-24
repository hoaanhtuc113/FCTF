import { useEffect, useState } from "react";
import { Link, useParams } from 'react-router-dom';
import { API_GET_DATE_CONFIG, BASE_URL, GET_CHALLENGE_LIST_PATH } from "../../constants/ApiConstant";
import ApiHelper from "../../utils/ApiHelper";

const ChallengeList = () => {
    const { categoryName } = useParams();
    const [challenges, setChallenges] = useState([]);
    const [error, setError] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);
    const [isContestActive, setIsContestActive] = useState(false);

    useEffect(() => {
        const fetchChallenge = async () => {
            const api = new ApiHelper(BASE_URL);
            try {
                const response = await api.get(GET_CHALLENGE_LIST_PATH + encodeURIComponent(categoryName));
                setChallenges(response.data);
                setError(false);
            } catch (err) {
                console.error("Error fetching challenges:", err);
                setError(true);
            }
        };

        fetchChallenge();
    }, [categoryName]);

    useEffect(() => {
        const fetchDateConfig = async () => {
            const api = new ApiHelper(BASE_URL);
            try {
                const response = await api.get(`${API_GET_DATE_CONFIG}`);
                if (response.isSuccess) {
                    const { message, start_date, end_date } = response;

                    if (message === "CTFd has not been started" && start_date) {
                        const startDate = new Date(start_date * 1000);
                        if (new Date() < startDate) {
                            setStatusMessage("Contest is starting soon!");
                            setIsContestActive(false);
                        }
                    } else if (message === "CTFd has been started" && end_date) {
                        const endDate = new Date(end_date * 1000);
                        if (new Date() < endDate) {
                            setIsContestActive(true);
                            setStatusMessage("The contest is ongoing!");
                        }
                    } else {
                        setStatusMessage("The contest has ended.");
                        setIsContestActive(false);
                    }
                } else {
                    setStatusMessage("Error fetching contest details.");
                }
            } catch (error) {
                setStatusMessage("Error connecting to the server.");
                console.error("Fetch error:", error);
            }
        };

        fetchDateConfig();
    }, []);

    return (
        <div className="container mx-auto px-4 py-8">
            <h2 className="text-4xl font-bold text-center mb-4 text-[#f17226]" role="heading">
                Topic: {categoryName}
            </h2>
            <div className="text-center mb-4 text-white rounded-lg px-4 py-2">
                {statusMessage}
            </div>

            <div className="space-y-4">
                {challenges.map((challenge) => (
                    <Link
                        key={challenge.id}
                        to={isContestActive ? `/challenge/${challenge.id}` : '#'}
                        className={`block w-full group ${isContestActive ? 'transition' : ''}`}
                    >
                        <div
                            className={`w-full flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-4 border rounded-lg shadow-sm transition-all duration-200
                                ${isContestActive ? 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 group-hover:bg-[#fef3e7] dark:group-hover:bg-gray-700 group-hover:shadow-lg group-hover:border-[#f17226] dark:group-hover:border-[#f17226] cursor-pointer' : 'bg-gray-200 dark:bg-gray-700 opacity-60 cursor-not-allowed border-gray-300 dark:border-gray-700'}
                            `}
                        >
                            <div className="flex-1">
                                <h3 className={`text-lg font-semibold ${isContestActive ? 'text-theme-color-primary-content dark:text-white group-hover:text-[#f17226]' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {challenge.name}
                                </h3>
                                <div className="text-sm mt-1 space-y-1">
                                    <p className={`${isContestActive ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>
                                        <b>Time Limit:</b> {challenge.time_limit > 0 ? `${challenge.time_limit} minutes` : 'UNLIMITED'}
                                    </p>
                                    <p className={`${isContestActive ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>
                                        <b>Max Attempts:</b> {challenge.max_attempts === 0 ? 'UNLIMITED' : challenge.max_attempts}
                                    </p>
                                    <p className={`${isContestActive ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>
                                        <b>Points:</b> {challenge.value}
                                    </p>
                                </div>
                            </div>

                            {isContestActive && (
                                <div className="mt-4 sm:mt-0 sm:ml-4 min-w-[160px] flex justify-end">
                                    {challenge.solve_by_myteam ? (
                                        <button
                                            className="w-full min-w-[150px] max-w-[180px] bg-green-500 text-white px-4 py-2 rounded cursor-default font-semibold text-center transition-all duration-200"
                                            disabled
                                        >
                                            Completed
                                        </button>
                                    ) : (
                                        <button
                                            className="w-full min-w-[150px] max-w-[180px] bg-[#f17226] text-white px-4 py-2 rounded font-semibold text-center transition-all duration-200 group-hover:bg-orange-600 dark:group-hover:bg-orange-700"
                                        >
                                            Not Completed
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </Link>
                ))}
            </div>

            {error && (
                <div className="mt-4 text-center text-theme-color-neutral-dark">
                    Unable to fetch categories. Showing sample data.
                </div>
            )}
        </div>
    );
};

export default ChallengeList;
