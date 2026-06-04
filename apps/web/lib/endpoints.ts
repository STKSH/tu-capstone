/**
 * API Endpoint Configuration
 */

const isServer = typeof window === 'undefined';

// Helper to determine the backend base URL dynamically
const getBaseUrl = () => {
  if (!isServer) {
    // Client-side: use the same hostname and protocol as the frontend, but port 8080
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8080`;
  }
  // Server-side (SSR inside Docker): ALWAYS use the docker service name
  return 'http://orchestrator:8080';
};

// Prioritize internal URL on server, but allow environment variable override for client
export const API_CONFIG = {
  BASE_URL: isServer 
    ? 'http://orchestrator:8080' 
    : (process.env.NEXT_PUBLIC_ORCHESTRATOR_BASE_URL || getBaseUrl()),
  TIMEOUT: 10000,
} as const;

export const ENDPOINTS = {
  AUTH: {
    ME: '/api/auth/me',
    LOGIN_TEMP: '/api/auth/login/temp',
    LOGOUT: '/api/auth/logout',
    WITHDRAW: '/api/auth/withdraw',
    REFRESH: '/api/auth/refresh',
    OAUTH2_GOOGLE: '/oauth2/authorization/google',
  },
  LECTURE: {
    LIST: '/api/lectures',
    CREATE: '/api/lectures',
    DETAIL: (id: number | string) => `/api/lectures/${id}`,
  },
  RECORD: {
    // No redundant internal endpoints
  },
  CHAT: {
    LIVE: '/api/chat/live',
    LIVE_STREAM: '/api/chat/live/stream',
  }
} as const;

export type ApiEndpoint = typeof ENDPOINTS;
