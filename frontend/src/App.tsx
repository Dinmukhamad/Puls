import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { Skeleton } from "./components/ui";
import { AdminOperatorsPage } from "./pages/AdminOperatorsPage";
import { AdminRequestsPage } from "./pages/AdminRequestsPage";
import { CabinetPage } from "./pages/CabinetPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RatingPage } from "./pages/RatingPage";
import { ShopPage } from "./pages/ShopPage";

export function App() {
  const { user, loading, atLeast } = useAuth();

  if (loading) {
    return (
      <div className="boot">
        <Skeleton height={44} width={220} radius="var(--radius-m)" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  // Навигация строится по роли заранее; источником прав остаётся бэкенд.
  const staff = atLeast("supervisor");

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/cabinet" replace />} />
        <Route path="/cabinet" element={<CabinetPage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin/operators"
          element={staff ? <AdminOperatorsPage /> : <Navigate to="/cabinet" replace />}
        />
        <Route
          path="/admin/requests"
          element={staff ? <AdminRequestsPage /> : <Navigate to="/cabinet" replace />}
        />
        <Route path="*" element={<Navigate to="/cabinet" replace />} />
      </Route>
    </Routes>
  );
}
