import axios from "axios";
import React, { useEffect, useState } from "react";
import { FaEye, FaEyeSlash, FaSpinner } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import {
  API_GET_REGISTER_STATE,
  BASE_URL,
  LOGIN_PATH,
} from "../../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../../constants/LocalStorageKey";
import ApiHelper from "../../utils/ApiHelper";
import { useUser } from "../contexts/UserContext";

const LoginComponent = () => {
  const { login } = useUser();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  const [errors, setErrors] = useState({
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegisterVisible, setIsRegisterVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(ACCESS_TOKEN_KEY)) {
      navigate("/");
    }
  }, [navigate]);

  useEffect(() => {
    const getRegisterState = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const response = await api.get(API_GET_REGISTER_STATE);
        if (response.success) {
          setIsRegisterVisible(response.Visibly);
        } else {
          console.error("Failed to get registration config:", response.error);
        }
      } catch (error) {
        console.error(
          "An error occurred while fetching registration config:",
          error
        );
      }
    };
    getRegisterState();
  }, []);

  const validateUsername = (username) => {
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    if (!username) {
      return "Username is required";
    }
    if (!usernameRegex.test(username)) {
      return "Username should not contain special characters";
    }
    return "";
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === "username") {
      setErrors((prev) => ({ ...prev, username: validateUsername(value) }));
    } else if (name === "password") {
      setErrors((prev) => ({ ...prev }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const usernameError = validateUsername(formData.username);
    if (usernameError) {
      setErrors({ username: usernameError });
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post(BASE_URL + LOGIN_PATH, formData, {
        validateStatus: (status) => status < 500, // Accept all statuses below 500
      });

      if (response.status === 200) {
        localStorage.setItem(ACCESS_TOKEN_KEY, response.data.generatedToken);

        login({
          id: response.data.user.id,
          name: formData.username,
          token: response.data.generatedToken,
          team: response.data.user.team || "No team",
        });

        console.log("Login successful!!!");
        if (response.data.user.team == null) {
          Swal.fire({
            title: "Team Confirmation Required",
            text: "You need to join a team",
            icon: "info",
            confirmButtonText: "To the Team Confirm Page",
          }).then(() => {
            navigate("/team-confirm");
          });
        } else {
          navigate("/");
        }
      } else if (response.status === 400) {
        const errorMessage =
          response.data.msg ||
          response.data.message ||
          "Invalid input. Please check and try again!";
        if (errorMessage.toLowerCase().includes("team")) {
          localStorage.setItem(ACCESS_TOKEN_KEY, response.data.generatedToken);
          login({
            id: response.data.user?.id,
            name: formData.username,
            token: response.data.generatedToken,
            team: response.data.user.team || { teamName: "No team" },
          });
          Swal.fire({
            title: "Team Confirmation Required",
            text: errorMessage,
            icon: "info",
            confirmButtonText: "To the Team Confirm Page",
          }).then(() => {
            navigate("/team-confirm");
          });
        } else {
          Swal.fire({
            title: "Login Failed!",
            text: errorMessage,
            icon: "error",
            confirmButtonText: "GOT IT!",
          });
        }
      } else {
        Swal.fire({
          title: "Login Failed!",
          text:
            response.data.msg ||
            response.data.message ||
            "Unexpected error occurred. Please try again!",
          icon: "error",
          confirmButtonText: "GOT IT!",
        });
      }
    } catch (error) {
      Swal.fire({
        title: "Login Fail!",
        text:
          error.response?.data?.msg ||
          error.response?.data?.message ||
          "Invalid username or password. Please try again!",
        icon: "error",
        confirmButtonText: "GOT IT!",
      });
      console.error("Login failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class="h-screen w-screen flex ">
      <div class="w-2/5 dark:bg-gray-900 text-white flex flex-col justify-center items-center p-10 relative bg-gradient-to-br from-base-medium to-neutral-medium"
        style={{ backgroundImage: "url('/ctf-bg.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}>

        <div class="absolute bottom-6 left-10 text-sm opacity-70">
          🌐 English
        </div>
      </div>


      <div class="w-3/5 bg-white flex flex-col justify-center px-16">
        <div className="text-center mb-8">
          <div className="align-items-center mb-4">
            <img className="h-20 w-auto theme-color-primary mx-auto" src="/fctf-logo.png" alt="Logo" onError={(e) => {
              e.target.onerror = null; e.target.src = "/fctf-logo.png";
            }} />
          </div>
          <h1 class="text-3xl font-bold mb-4">Welcome to FPTU Hackathon</h1>
        </div>
        {/* <div class="flex justify-between items-center mb-8 justify-center">
          <h2 class="text-2xl font-semibold text-gray-700">Sign in</h2>
        </div> */}

        <form onSubmit={handleSubmit} class="space-y-6" noValidate>
          <div>
            <label htmlFor="username" class="block text-sm font-medium text-gray-600">Username</label>
            <input type="text" id="username" name="username" value={formData.username} onChange={handleInputChange} class="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" required />
            {errors.username && (
              <p
                className="mt-2 text-sm text-red-600"
                id="username-error"
                role="alert"
              >
                {errors.username}
              </p>
            )}
          </div>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-600">Password</label>
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-11 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
          {errors.password && (
            <p
              className="mt-2 text-sm text-red-600"
              id="password-error"
              role="alert"
            >
              {errors.password}
            </p>
          )}
          <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition">Login</button>
        </form>

      </div>
    </div >
  );
};

export default LoginComponent;

