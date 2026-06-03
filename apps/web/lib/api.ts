import { API_CONFIG } from './endpoints';

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const baseUrl = API_CONFIG.BASE_URL.endsWith('/') 
    ? API_CONFIG.BASE_URL.slice(0, -1) 
    : API_CONFIG.BASE_URL;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const url = endpoint.startsWith('http') 
    ? endpoint 
    : `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // 401 Unauthorized Handling (Token Expired or Not Logged In)
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      
      // Prevent infinite loop if we are already on the login page or trying to refresh
      if (pathname !== '/login' && !endpoint.includes('/api/auth/refresh')) {
        try {
          const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include'
          });
          
          if (refreshRes.ok) {
            // Retry the original request
            const retryResponse = await fetch(url, { ...options, headers, credentials: 'include' });
            if (retryResponse.ok) {
              if (retryResponse.status === 204) return {} as T;
              const retryText = await retryResponse.text();
              if (!retryText) return {} as T;
              try {
                return JSON.parse(retryText) as T;
              } catch (err) {
                return retryText as unknown as T;
              }
            }
          }
        } catch (err) {
          console.error('Refresh token failed', err);
        }
        
        // If everything fails, redirect to login (only if not already there)
        window.location.href = `/login?error=session_expired&from=${encodeURIComponent(pathname)}`;
      }
    }
    // For SSR or when we can't redirect, throw error
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      if (errorText) {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorMessage;
      }
    } catch (err) {
      // Not JSON
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // If it's not JSON, return as is (casted to T)
    return text as unknown as T;
  }
}
