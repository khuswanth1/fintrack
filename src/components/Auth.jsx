import { useState, useEffect } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import { auth } from "../firebase/firebase.js";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        console.log("User logged in:", currentUser);
      } else {
        console.log("User logged out");
      }
    });
    return () => unsubscribe();
  }, []);

  const handleRegister = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log("Registered:", result.user);
    } catch (err) {
      console.error(err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log("Logged in:", result.user);
    } catch (err) {
      console.error(err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      console.log("Google User:", result.user);
    } catch (err) {
      console.error(err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log("Logged out");
    } catch (err) {
      console.error(err);
    }
  };

  if (user) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#16171c] border border-slate-200 dark:border-white/10 text-center">
        <div className="mb-4">
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName || "User"}
              className="mx-auto h-16 w-16 rounded-full border-2 border-brand-500 shadow"
            />
          )}
          <h2 className="mt-2 text-xl font-bold text-slate-800 dark:text-white">
            Welcome, {user.displayName || user.email}!
          </h2>
          <p className="text-xs text-slate-500">{user.email}</p>
          <span className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Authenticated via Firebase
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full rounded-xl bg-rose-600 px-4 py-2.5 font-medium text-white shadow transition hover:bg-rose-700 active:scale-95"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#16171c] border border-slate-200 dark:border-white/10">
      <h2 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white text-center">
        Firebase Authentication
      </h2>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
          {error}
        </div>
      )}

      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Email
          </label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Password
          </label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex space-x-3 pt-2">
          <button
            type="button"
            onClick={handleRegister}
            disabled={loading}
            className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-brand-700 disabled:opacity-50 active:scale-95 transition"
          >
            Register
          </button>
          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="flex-1 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 active:scale-95 transition"
          >
            Login
          </button>
        </div>
      </form>

      <div className="relative my-6 flex items-center justify-center">
        <div className="w-full border-t border-slate-200 dark:border-white/10"></div>
        <span className="absolute bg-white px-3 text-xs text-slate-400 dark:bg-[#16171c]">
          OR
        </span>
      </div>

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="flex w-full items-center justify-center space-x-2 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 active:scale-95 disabled:opacity-50"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.29v3.15C3.26 21.3 7.31 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.29C.47 8.21 0 10.05 0 12s.47 3.79 1.29 5.42l3.99-3.15z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.58l3.99 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
          />
        </svg>
        <span>Continue with Google</span>
      </button>
    </div>
  );
}
