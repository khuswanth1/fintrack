import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { RealtimeProvider } from "./context/RealtimeContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import Layout from "./components/Layout.jsx";
import { Spinner } from "./components/ui.jsx";
import { LoginPage, RegisterPage } from "./pages/AuthPages.jsx";

// Route-level code splitting keeps the initial bundle small.
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Transactions = lazy(() => import("./pages/Transactions.jsx"));
const Budgets = lazy(() => import("./pages/Budgets.jsx"));
const Goals = lazy(() => import("./pages/Goals.jsx"));
const Recurring = lazy(() => import("./pages/Recurring.jsx"));
const Categories = lazy(() => import("./pages/Categories.jsx"));
const Insights = lazy(() => import("./pages/Insights.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));
const Webhooks = lazy(() => import("./pages/Webhooks.jsx"));
const Reports = lazy(() => import("./pages/Misc.jsx").then((m) => ({ default: m.Reports })));
const Notifications = lazy(() => import("./pages/Misc.jsx").then((m) => ({ default: m.Notifications })));
const Settings = lazy(() => import("./pages/Misc.jsx").then((m) => ({ default: m.Settings })));
const NotFound = lazy(() => import("./pages/Misc.jsx").then((m) => ({ default: m.NotFound })));

function RequireAuth({ role }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="grid min-h-screen place-items-center"><Spinner label="Loading FinTrack…" /></div>;
  if (status !== "authenticated") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <Outlet />;
}

const FirebaseAuthDemo = lazy(() => import("./components/Auth.jsx"));

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/firebase-auth" element={<div className="p-8"><FirebaseAuthDemo /></div>} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="goals" element={<Goals />} />
            <Route path="recurring" element={<Recurring />} />
            <Route path="categories" element={<Categories />} />
            <Route path="webhooks" element={<Webhooks />} />
            <Route path="insights" element={<Insights />} />
            <Route path="reports" element={<Reports />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
            <Route element={<RequireAuth role="admin" />}>
              <Route path="admin" element={<Admin />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>
            <BrowserRouter><AppRoutes /></BrowserRouter>
          </RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
