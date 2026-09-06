import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";

import { useAuth } from "./auth/AuthContext";
import { useAccess } from "./auth/AccessContext";
import { SectionGuard } from "./components/SectionGuard";
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

const AccessAdminPage = lazy(() => import("./pages/AccessAdminPage").then((module) => ({ default: module.AccessAdminPage })));

export function App() {
  const { user, loading, atLeast, restoreError, retryRestore } = useAuth();
  const access = useAccess();

  if (loading) {
    return (
      <div className="boot">
        <Skeleton height={44} width={220} radius="var(--radius-m)" />
      </div>
    );
  }

  if (!user && restoreError) return <div className="boot"><ErrorState error={restoreError} onRetry={retryRestore} /></div>;
  if (!user) return <LoginPage />;

  if (access.loading) return <div className="boot"><Skeleton height={44} width={220} /></div>;
  if (access.error) return <div className="boot"><ErrorState error={access.error} onRetry={access.refresh} /></div>;

  return (
    <Routes>
      <Route path="/simulator/attempts/:attemptId" element={<SectionGuard><SimulatorPage /></SectionGuard>} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={access.home} replace />} />
        <Route path="/admin/access" element={atLeast("admin") ? <Suspense fallback={<Skeleton height={300} />}><AccessAdminPage /></Suspense> : <AccessPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/cabinet" element={<CabinetPage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/admin/wallet" element={<WalletPage administrative />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/admin/games" element={<GamesPage administrative />} />
        <Route path="/training/attempts/:attemptId" element={<LearningPlayerPage />} />
        <Route path="/admin/learning" element={<LearningStudioPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/summary" element={<SummaryPage />} />
        <Route path="/admin/xp" element={<XpAdminPage />} />
        <Route path="/admin/levels" element={<XpAdminPage levelsOnly />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/admin/store" element={<StoreAdminPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/users/:userId" element={<UserDetailPage />} />
        <Route path="/admin/groups" element={<GroupsPage />} />
        <Route path="/admin/periods" element={<PeriodsPage />} />
        <Route path="/admin/sessions" element={atLeast("admin") ? <SessionsPage administrative /> : <AccessPage />} />
        <Route path="/admin/audit" element={atLeast("admin") ? <AuditPage /> : <AccessPage />} />
        <Route
          path="/admin/operators"
          element={<AdminOperatorsPage />}
        />
        <Route
          path="/admin/requests"
          element={<AdminRequestsPage />}
        />
        <Route path="*" element={<AccessPage missing />} />
      </Route>
    </Routes>
  );
}
