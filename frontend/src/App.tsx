import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";

import ProtectedRoute from "./ProtectedRoute";

import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import PublicProfile from "./pages/PublicProfile";
import Settings from "./pages/Settings";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword"; // ✅ ADD

import Splash from "./components/Splash";
import { SocketProvider } from "./lib/socketContext";
import { applySettings } from "./lib/settings";
import AlertsHost from "./components/AlertsHost";
import PhotoViewer from "./components/PhotoViewer";

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Chat wallpaper and other local preferences apply on every page.
    applySettings();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <Splash />;
  }

  return (
    <SocketProvider>
      <Routes>
        <Route path="/" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* 🔥 FORGOT PASSWORD */}
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* 🔥 RESET PASSWORD */}
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ✅ only ONE user profile route */}
        <Route path="/user/:id" element={<PublicProfile />} />

        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
      </Routes>

      {/* Global rings + alerts on every logged-in page */}
      <AlertsHost />
      <PhotoViewer />
    </SocketProvider>
  );
}

export default App;