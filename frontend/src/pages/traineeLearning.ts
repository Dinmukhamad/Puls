/**
 * A trainee's learning (docs/TRAINEE.md): their missions as the server checked them, shared by the cabinet and the city.
 * Each read also counts the missions whose results the trainers have recorded, so nobody marks one done by hand.
 */
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/client";
import type { CityData, CityMission } from "../api/city";
import { useAuth } from "../auth/AuthContext";

export const traineeLearningKey = (userId: number | undefined) => ["trainee-learning", userId] as const;

export function useTraineeLearning() {
  const { user } = useAuth();
  return useQuery({
    queryKey: traineeLearningKey(user?.id),
    queryFn: ({ signal }) => request<CityData>("/api/v1/learning/trainee/progress", { method: "POST", signal, timeoutMs: 25000 }),
    enabled: user?.role === "trainee", staleTime: 0, refetchOnWindowFocus: "always",
  });
}

export function trainingSummary(data: Pick<CityData, "missions">) {
  const missions = data.missions.filter(mission => mission.enabled || mission.state === "completed");
  const completed = missions.filter(mission => mission.state === "completed").length;
  return { missions, completed, total: missions.length, percent: missions.length ? Math.round(completed / missions.length * 100) : 0 };
}

/** A call to action must never point at a locked or paused mission. */
export function currentTrainingMission(missions: CityMission[]) {
  const active = missions.filter(mission => mission.enabled);
  return active.find(mission => mission.state === "ready")
    ?? active.find(mission => mission.state === "in_progress")
    ?? active.find(mission => mission.state === "available");
}
