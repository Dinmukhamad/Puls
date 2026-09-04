import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { Spinner } from "./components/ui";
import { AdminOperatorsPage } from "./pages/AdminOperatorsPage";
import { AdminRequestsPage } from "./pages/AdminRequestsPage";
import { CabinetPage } from "./pages/CabinetPage";
import { RatingPage } from "./pages/RatingPage";
import { ShopPage } from "./pages/ShopPage";

export function App() {
  const { user, loading, atLeast } = useAuth();

  if (loading) {
    return (
      <div className="boot">
        <Spinner label="Проверяем сессию" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const staff = atLeast("supervisor");

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/cabinet" replace />} />
        <Route path="/cabinet" element={<CabinetPage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/shop" element={<ShopPage />} />
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
