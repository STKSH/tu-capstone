'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { User, TokenResponse, AuthState } from '../types/auth';
import { apiFetch } from '../lib/api';
import { ENDPOINTS } from '../lib/endpoints';

interface AuthContextType extends AuthState {
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  withdraw: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const refreshUser = useCallback(async () => {
    try {
      const user = await apiFetch<User>(ENDPOINTS.AUTH.ME);
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to fetch user:', error);
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  useEffect(() => {
    // Prevent infinite loop if already on login page
    if (pathname === '/login') {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    void refreshUser();
  }, [refreshUser, pathname]);

  const login = useCallback(async (email: string) => {
    try {
      await apiFetch<TokenResponse>(
        `${ENDPOINTS.AUTH.LOGIN_TEMP}?email=${encodeURIComponent(email)}`, 
        { method: 'POST' }
      );
      await refreshUser();
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await apiFetch(ENDPOINTS.AUTH.LOGOUT, { method: 'POST' });
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  const withdraw = useCallback(async () => {
    try {
      await apiFetch(ENDPOINTS.AUTH.WITHDRAW, { method: 'POST' });
    } catch (error) {
      console.error('Withdraw failed:', error);
      throw error;
    } finally {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, withdraw, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
