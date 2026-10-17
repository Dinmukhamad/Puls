/**
 * «Навыки» (docs/CITY_MISSIONS.md, «Раздел „Навыки“»): the overview of every district with its progress and the next
 * mission, and a district's missions by name. Pure helpers of CitySkillsPanel.
 */
import type { CityDistrict, CityMission } from "../../api/city";
import { completedDistrictMissions } from "./cityLevels";

/** The missions a district counts: the curriculum's enabled ones and those already passed. */
export const countedMissions = (district: CityDistrict, missions: CityMission[]) =>
  missions.filter(m => m.district === district.id && (m.enabled || m.state === "completed"));

export interface DistrictProgress { done: number; total: number; mastered: boolean; reward: boolean }
/** How far the district is: missions passed of all, whether all are, and whether a reward waits to be taken. */
export function districtProgress(district: CityDistrict, missions: CityMission[]): DistrictProgress {
  const own = countedMissions(district, missions), done = completedDistrictMissions(district, missions);
  const total = Math.max(own.length, done);
  return { done, total, mastered: !district.soon && total > 0 && done >= total, reward: own.some(m => m.state === "ready") };
}

/** The line under a mission's name: what it waits for, in a few words. */
export function missionNote(mission: CityMission, missions: CityMission[]) {
  switch (mission.state) {
    case "completed": return "Пройдено";
    case "ready": return "Готово — забери награду";
    case "unavailable": return "На паузе";
    case "locked": {
      const parent = missions.find(m => m.key === mission.prerequisite);
      return parent ? `Сначала «${parent.title}»` : "Впереди";
    }
    case "in_progress": return `В процессе · ${mission.current} из ${mission.target}`;
    default: return "Можно начать";
  }
}

/**
 * The mission to go on with across the city: a reward waiting first, then one in progress, then one that can start, in
 * the districts' order. None when everything open is passed.
 */
export function continueMission(districts: CityDistrict[], missions: CityMission[]) {
  const open = districts.filter(d => !d.soon).flatMap(d => missions.filter(m => m.district === d.id && m.enabled));
  for (const state of ["ready", "in_progress", "available"] as const) {
    const mission = open.find(m => m.state === state);
    if (mission) return mission;
  }
  return null;
}

/**
 * The mission open in a district: the one asked for, else the one to do next. A mastered district opens none, so it
 * reads as a summary until a mission is chosen.
 */
export function openMission(missions: CityMission[], asked: string | null, mastered: boolean) {
  const chosen = missions.find(m => m.key === asked);
  if (chosen || mastered) return chosen ?? null;
  return missions.find(m => m.state === "ready") ?? missions.find(m => m.state === "in_progress")
    ?? missions.find(m => m.state === "available") ?? missions.find(m => m.state !== "completed") ?? missions[0] ?? null;
}
