declare global {
  interface Window {
    __ENV__?: {
      VITE_API_URL?: string;
      VITE_BASE_GATEWAY?: string;
      VITE_HTTP_PORT?: string;
      VITE_TCP_PORT?: string;
      // ... các biến khác nếu có
    };
  }
}
export { };