import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { ErrorState, Skeleton } from "./components/ui";
import { AdminOperatorsPage } from "./pages/AdminOperatorsPage";
import { AdminRequestsPage } from "./pages/AdminRequestsPage";
import { CabinetPage } from "./pages/CabinetPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RatingPage } from "./pages/RatingPage";
import { ShopPage } from "./pages/ShopPage";
import { UsersPage } from "./pages/UsersPage";
import { GroupsPage } from "./pages/GroupsPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { PeriodsPage } from "./pages/PeriodsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { AuditPage } from "./pages/AuditPage";
import { AccessPage } from "./pages/AccessPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SummaryPage } from "./pages/SummaryPage";
import { ProgressPage } from "./pages/ProgressPage";
import { XpAdminPage } from "./pages/XpAdminPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoreAdminPage } from "./pages/StoreAdminPage";
import { TrainingPage } from "./pages/TrainingPage";
import { LearningPlayerPage } from "./pages/LearningPlayerPage";
import { LearningStudioPage } from "./pages/LearningStudioPage";
import { SimulatorPage } from "./pages/SimulatorPage";
import { GamesPage } from "./pages/GamesPage";
import { WalletPage } from "./pages/WalletPage";
import { ReportsPage } from "./pages/ReportsPage";

export function App() {
  const { user, loading, atLeast, restoreError, retryRestore } = useAuth();

  if (loading) {
    return (
      <div className="boot">
        <Skeleton height={44} width={220} radius="var(--radius-m)" />
      </div>
    );
  }

  if (!user && restoreError) return <div className="boot"><ErrorState error={restoreError} onRetry={retryRestore} /></div>;
  if (!user) return <LoginPage />;

  // Навигация строится по роли заранее; источником прав остаётся бэкенд.
  const staff = atLeast("supervisor");

  return (
    <Routes>
      <Route path="/simulator/attempts/:attemptId" element={<SimulatorPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={staff ? "/admin/summary" : "/cabinet"} replace />} />
        <Route path="/reports" element={atLeast("head") ? <ReportsPage /> : <AccessPage />} />
        <Route path="/cabinet" element={<CabinetPage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/admin/wallet" element={staff ? <WalletPage administrative /> : <AccessPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/admin/games" element={staff ? <GamesPage administrative /> : <AccessPage />} />
        <Route path="/training/attempts/:attemptId" element={<LearningPlayerPage />} />
        <Route path="/admin/learning" element={staff ? <LearningStudioPage /> : <AccessPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/analytics" element={staff ? <AnalyticsPage /> : <AccessPage />} />
        <Route path="/admin/summary" element={staff ? <SummaryPage /> : <AccessPage />} />
        <Route path="/admin/xp" element={staff ? <XpAdminPage /> : <AccessPage />} />
        <Route path="/admin/levels" element={staff ? <XpAdminPage levelsOnly /> : <AccessPage />} />
        <Route path="/admin/settings" element={staff ? <SettingsPage /> : <AccessPage />} />
        <Route path="/admin/store" element={staff ? <StoreAdminPage /> : <AccessPage />} />
        <Route path="/admin/users" element={staff ? <UsersPage /> : <AccessPage />} />
        <Route path="/admin/users/:userId" element={staff ? <UserDetailPage /> : <AccessPage />} />
        <Route path="/admin/groups" element={staff ? <GroupsPage /> : <AccessPage />} />
        <Route path="/admin/periods" element={staff ? <PeriodsPage /> : <AccessPage />} />
        <Route path="/admin/sessions" element={atLeast("admin") ? <SessionsPage administrative /> : <AccessPage />} />
        <Route path="/admin/audit" element={atLeast("admin") ? <AuditPage /> : <AccessPage />} />
        <Route
          path="/admin/operators"
          element={staff ? <AdminOperatorsPage /> : <AccessPage />}
        />
        <Route
          path="/admin/requests"
          element={staff ? <AdminRequestsPage /> : <AccessPage />}
        />
        <Route path="*" element={<AccessPage missing />} />
      </Route>
    </Routes>
  );
}
