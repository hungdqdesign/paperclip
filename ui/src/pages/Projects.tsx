import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { cn, formatDate, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Hexagon, Plus } from "lucide-react";
import type { ProjectStatus } from "@paperclipai/shared";

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ["backlog", "planned", "in_progress", "completed", "cancelled"];

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const projects = useMemo(() => {
    const active = (allProjects ?? []).filter((p) => !p.archivedAt);
    if (!statusFilter) return active;
    return active.filter((p) => p.status === statusFilter);
  }, [allProjects, statusFilter]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter(null)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
              statusFilter === null
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            All
          </button>
          {PROJECT_STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                statusFilter === s
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={openNewProject}>
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && (
        <div className="border border-border">
          {projects.map((project) => (
            <EntityRow
              key={project.id}
              title={project.name}
              subtitle={project.description ?? undefined}
              to={projectUrl(project)}
              trailing={
                <div className="flex items-center gap-3">
                  {project.targetDate && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(project.targetDate)}
                    </span>
                  )}
                  <StatusBadge status={project.status} />
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
