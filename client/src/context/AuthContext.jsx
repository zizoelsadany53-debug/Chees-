import { createContext, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { getStoredUser, getToken, setSession } from "../services/api.js";
import { fetchMe, loginUser, logoutUser, registerUser } from "../services/auth.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [token, setToken] = useState(getToken());
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!token) return setLoading(false);
    fetchMe()
      .then(({ user: freshUser }) => {
        setUser(freshUser);
        setSession({ token, user: freshUser });
      })
      .catch(() => {
        logoutUser();
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: Boolean(token && user),
      async login(credentials) {
        const data = await loginUser(credentials);
        setUser(data.user);
        setToken(data.token);
        toast.success("Welcome back");
      },
      async register(payload) {
        const data = await registerUser(payload);
        if (!data.user?.id) {
          const freshData = await fetchMe();
          setUser(freshData.user);
          setSession({ token: data.token, user: freshData.user });
        } else {
          setUser(data.user);
        }
        setToken(data.token);
        toast.success("Account created");
      },
      logout() {
        logoutUser();
        setUser(null);
        setToken(null);
      },
      setUser
    }),
    [loading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
