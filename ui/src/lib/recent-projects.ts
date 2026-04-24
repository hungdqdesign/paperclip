const STORAGE_KEY = "paperclip:recent-projects";
const MAX_RECENT = 10;

export function getRecentProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function trackRecentProject(projectId: string): void {
  if (!projectId) return;
  const recent = getRecentProjectIds().filter((id) => id !== projectId);
  recent.unshift(projectId);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
}

export function sortProjectsByRecency<T extends { id: string }>(
  projects: T[],
  recentIds: string[],
): T[] {
  const recentIndex = new Map(recentIds.map((id, i) => [id, i]));
  return [...projects].sort((a, b) => {
    const aRecent = recentIndex.get(a.id);
    const bRecent = recentIndex.get(b.id);
    if (aRecent !== undefined && bRecent !== undefined) return aRecent - bRecent;
    if (aRecent !== undefined) return -1;
    if (bRecent !== undefined) return 1;
    return 0;
  });
}
