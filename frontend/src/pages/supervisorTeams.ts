import type { SupervisorTeam, TeamGroup } from "../api/team";
import type { UserOut } from "../api/types";

/** Archived groups retain their history, but cannot receive new operators. */
export function activeTeamGroups(team: SupervisorTeam): TeamGroup[] {
  return team.groups.filter((group) => group.is_active);
}

/** A legacy supervisor may own several groups, each attached to a different district. */
export function destinationGroupId(team: SupervisorTeam, requested: string, current?: number | null): number | null {
  const groups = activeTeamGroups(team);
  if (groups.length === 1) return groups[0].id;
  if (!groups.length) return null;
  const value = requested.trim();
  if (value) {
    // Reject a removed/archived selection instead of silently transferring elsewhere.
    if (!/^\d+$/.test(value)) return null;
    const id = Number(value);
    return groups.some((group) => group.id === id) ? id : null;
  }
  return current != null && groups.some((group) => group.id === current) ? current : null;
}

/** Include legacy ownership problems so an existing group is never shown as unassigned. */
export function userTeamLabel(user: UserOut, groups: TeamGroup[]): string {
  if (!user.group) return "Без команды";
  const group = groups.find((candidate) => candidate.id === user.group?.id);
  if (!group) return `${user.group.name} · Супервайзер неизвестен`;
  const name = group.is_active ? group.name : `${group.name} (архив)`;
  return group.supervisor
    ? `${group.supervisor.full_name} · ${name}`
    : `${name} · Супервайзер не назначен`;
}

/** Moving between groups changes district access even when the supervisor stays the same. */
export function assignmentTransferUsers(users: UserOut[], target: SupervisorTeam, destinationGroup: number | null): UserOut[] {
  if (destinationGroup == null || !activeTeamGroups(target).some((group) => group.id === destinationGroup)) return [];
  return users.filter((user) => user.role === "operator" && user.group != null && user.group.id !== destinationGroup);
}
