import type { SupervisorTeam, TeamGroup } from "../api/team";
import type { Role, UserOut } from "../api/types";
import { plural } from "../utils/format";
import { userTeamLabel } from "./supervisorTeams";

/** «Команда» (docs/TEAM_SECTION.md): every page is titled as its tab in the menu (navigation.ts). */
export function teamTitles(role?: Role) {
  return { users: role === "admin" ? "Пользователи" : "Операторы", groups: role === "supervisor" ? "Моя команда" : "Супервайзеры", metrics: "Показатели сотрудников" };
}

export const staffCount = (count: number) => `${count} ${plural(count, "сотрудник", "сотрудника", "сотрудников")}`;
export const operatorCount = (count: number) => `${count} ${plural(count, "оператор", "оператора", "операторов")}`;

/** A team created for a supervisor carries their name: shown under them, it would only repeat it. */
export function namedAfter(group: Pick<TeamGroup, "name">, supervisor: { full_name: string }): boolean {
  return group.name.trim().toLocaleLowerCase("ru") === supervisor.full_name.trim().toLocaleLowerCase("ru");
}

/** A supervisor's groups are listed under them only when they tell something: several, archived or named otherwise. */
export function groupsWorthShowing(team: SupervisorTeam): TeamGroup[] {
  const told = team.groups.length > 1 || team.groups.some(group => !group.is_active || !namedAfter(group, team.supervisor));
  return told ? team.groups : [];
}

/**
 * A person's team in a row of «Команда». A supervisor leads their own team; an operator's team is named by its supervisor.
 * A supervisor sees only their own groups, so another team is named as the server gave it, without a warning about it.
 */
export function teamOf(user: UserOut, groups: TeamGroup[], teams: SupervisorTeam[], actor?: Role): string {
  if (user.role === "supervisor") {
    const own = teams.find(item => item.supervisor.id === user.id);
    return own ? `Своя команда · ${operatorCount(own.operator_count)}` : "Своя команда";
  }
  const group = user.group && groups.find(item => item.id === user.group?.id);
  if (user.group && !group && actor === "supervisor") return user.group.name;
  const owner = group?.supervisor;
  if (group && owner && namedAfter(group, owner)) return `${owner.full_name}${group.is_active ? "" : " · команда в архиве"}`;
  return userTeamLabel(user, groups);
}
