import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearCsrfToken, fetchCsrfToken, setCsrfToken, unwrap } from "../lib/api";
import { endpoints } from "../lib/endpoints";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const response = await api.get(endpoints.auth.me);
      const payload = unwrap(response.data);
      const currentUser = payload?.user ?? payload;
      setUser(currentUser || null);
      return currentUser || null;
    } catch (error) {
      if (error.response?.status === 401) {
        setUser(null);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // 1. Initialize CSRF token from backend session
    fetchCsrfToken()
      .catch(() => {
        // Safe to ignore if anonymous session is being established
      })
      .then(() => api.get(endpoints.auth.me))
      .then(({ data }) => {
        if (mounted) {
          const payload = unwrap(data);
          setUser(payload?.user ?? payload ?? null);
        }
      })
      .catch(() => {
        if (mounted) setUser(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      refreshSession,
      async login(credentials) {
        const { data } = await api.post(endpoints.auth.login, credentials);
        const payload = unwrap(data);
        if (payload?.csrfToken) {
          setCsrfToken(payload.csrfToken);
        }
        const currentUser = await refreshSession().catch(() => payload?.user ?? null);
        setUser(currentUser);
        return currentUser;
      },
      async register(details) {
        const payload = {
          fullName: details.full_name || details.fullName,
          full_name: details.full_name || details.fullName,
          phone: details.phone,
          password: details.password,
        };
        const { data } = await api.post(endpoints.auth.register, payload);
        return unwrap(data);
      },
      async logout() {
        try {
          await api.post(endpoints.auth.logout);
        } finally {
          clearCsrfToken();
          setUser(null);
        }
      },
    }),
    [user, loading, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
