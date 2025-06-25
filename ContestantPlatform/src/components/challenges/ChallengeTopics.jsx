import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BASE_URL,
  GET_CHALLENGE_CATEGORIES_PATH,
} from "../../constants/ApiConstant";
import ApiHelper from "../../utils/ApiHelper";

const ChallengeTopics = () => {
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const response = await api.get(GET_CHALLENGE_CATEGORIES_PATH);
        setCategories(response.data);
        setError(false);
      } catch (err) {
        console.error("Error fetching categories:", err);
        setError(true);
      }
    };

    fetchCategories();
  }, []);

  return (
    <div className="flex">
      {/* <Sidebar isOpen={isSidebarOpen} toggleOpen={() => setIsSidebarOpen(!isSidebarOpen)} /> */}
      <div className={`flex-1 transition-all duration-300`}>
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6 justify-items-center">
            {categories.map((category) => (
              <Link
                to={`/topic/${category.topic_name}`}
                key={category.topic_name}
                className="w-full max-w-sm rounded-lg shadow-md border border-gray-700 bg-gray-800 hover:shadow-lg transform hover:scale-105 transition-all duration-300 ease-in-out p-6 cursor-pointer group"
              >
                <div className="flex flex-col items-center text-center space-y-3">
                  <h3 className="text-xl font-bold text-white group-hover:text-[#e45c25] transition-colors duration-200">
                    {category.topic_name}
                  </h3>
                  <p className="text-gray-300 group-hover:text-[#e45c25] transition-colors duration-200">
                    {category.challenge_count} Challenges
                  </p>
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
      </div>
    </div>
  );
};

export default ChallengeTopics;
