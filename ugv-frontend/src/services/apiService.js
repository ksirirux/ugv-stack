import axios from "axios";

// Create Axios Instance
const api = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor: Auto-inject JWT token from localStorage
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("ugv_token");
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Standardize payloads and handle token expiration globally
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("ugv_user");
      localStorage.removeItem("ugv_token");
      // Trigger global event to notify components
      window.dispatchEvent(new Event("auth_failed"));
    }
    const message = error.response?.data?.error || error.message || "API Request failed";
    return Promise.reject(new Error(message));
  }
);

export const apiService = {

  login: (username, password) => {
    return api.post("/api/auth/login", { username, password });
  },

  registerUser: (userData) => {
    return api.post("/api/auth/register", userData);
  },

  getUsers: () => {
    return api.get("/api/auth/users");
  },

  getRobots: () => {
    return api.get("/api/robots");
  },

  registerRobot: (robotData) => {
    return api.post("/api/robots", robotData);
  },

  deleteRobot: (id) => {
    return api.delete(`/api/robots/${id}`);
  },

  updateRobot: (id, robotData) => {
    return api.put(`/api/robots/${id}`, robotData);
  },

  getRobotLogs: (robotId, limit = 15) => {
    return api.get(`/api/robots/${robotId}/logs`, {
      params: { limit },
    });
  },

  getAllLogs: (filters = {}) => {
    const params = {
      page: filters.page || 1,
      limit: filters.limit || 25,
    };

    if (filters.robot_id) params.robot_id = filters.robot_id;
    if (filters.level) params.level = filters.level;
    if (filters.search) params.search = filters.search;

    return api.get("/api/robots/logs", { params });
  },
};
export default apiService;
