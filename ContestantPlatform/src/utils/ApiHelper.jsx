import axios from "axios";
import { ACCESS_TOKEN_KEY } from "../constants/LocalStorageKey";

class ApiHelper {
  constructor(baseURL, needsAuth = true) {
    this.needsAuth = needsAuth;
    this.api = axios.create({
      baseURL: baseURL,
      headers: needsAuth ? this._getAuthHeaders() : {},
    });

    this.api.interceptors.request.use((config) => {
      if (this.needsAuth) {
        const authHeaders = this._getAuthHeaders();
        config.headers = { ...config.headers, ...authHeaders };
      }
      return config;
    });

    // Thêm interceptors.response để xử lý lỗi 401
    if (needsAuth) {
      this.api.interceptors.response.use(
        (response) => response,
        (error) => {
          if (error.response && error.response.status === 401) {
            window.location.href = "/login"; // Chuyển hướng đến trang đăng nhập
          }
          if (error.response.status === 403) {
            console.error(
              "Access denied: You do not have permission to perform this action."
            );
            window.location.href = "/forbidden";
          }
          return Promise.reject(error);
        }
      );
    }
  }

  _getAuthHeaders() {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async get(url, params = {}) {
    try {
      const response = await this.api.get(url, { params });
      return response.data;
    } catch (error) {
      console.error("GET request error:", error);
      throw error;
    }
  }

  async getbyAuth(url, params = {}) {
    try {
      const headers = this._getAuthHeaders();
      const response = await this.api.get(url, { params, headers });
      return response.data;
    } catch (error) {
      console.error("GET request error:", error);
      throw error;
    }
  }

  async post(url, data = {}) {
    try {
      const response = await this.api.post(url, data);
      return response.data;
    } catch (error) {
      console.error("POST request error:", error);
      throw error;
    }
  }

  async postForm(url, data = {}) {
    try {
      const formData = new FormData();
      Object.keys(data).forEach((key) => formData.append(key, data[key]));
      console.log("formData", formData);
      const response = await this.api.post(url, formData, {
        headers: {},
      });
      return response.data;
    } catch (error) {
      console.error("POST Form request error:", error);
      throw error;
    }
  }

  async patch(url, data = {}, additionalHeaders = {}) {
    try {
      const headers = { ...this._getAuthHeaders(), ...additionalHeaders };
      const response = await this.api.patch(url, data, { headers });
      return response.data; // Directly return the parsed data
    } catch (error) {
      console.error("PATCH request error:", error);
      throw error; // Ensure errors propagate to the calling code
    }
  }
  async downloadFile(url, params = {}) {
    try {
      const headers = this._getAuthHeaders();
      const response = await this.api.get(url, { 
        params, 
        headers,
        responseType: 'blob' // Important: tells axios to return blob
      });
      return response.data; // This will be a Blob object
    } catch (error) {
      console.error("Download file error:", error);
      throw error;
    }
  }
}

export default ApiHelper;
