import axios from 'axios';

const API_BASE_URL = import.meta.env['VITE_API_URL'] || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 10_000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export default api;

api.interceptors.request.use((config) => {
  const match = document.cookie.match(/(?:^|; )tapcrm_csrf=([^;]+)/);
  if (match?.[1]) config.headers.set('X-CSRF-Token', decodeURIComponent(match[1]));
  return config;
});
