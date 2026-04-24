import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { issuesApi } from "../api/issues";
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
  const [labelFilter, setLabelFilter] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: allLabels } = useQuery({
    queryKey: queryKeys.issues.labels(selectedCompanyId!),
    queryFn: () => issuesApi.listLabels(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const usedLabelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allProjects ?? []) {
      for (const id of p.labelIds ?? []) ids.add(id);
    }
    return ids;
  }, [allProjects]);

  const usedLabels = useMemo(
    () => (allLabels ?? []).filter((l) => usedLabelIds.has(l.id)),
    [allLabels, usedLabelIds],
  );

  const projects = useMemo(() => {
    const active = (allProjects ?? []).filter((p) => !p.archivedAt);
    const byStatus = statusFilter ? active.filter((p) => p.status === statusFilter) : active;
    if (!labelFilter) return byStatus;
    return byStatus.filter((p) => (p.labelIds ?? []).includes(labelFilter));
  }, [allProjects, statusFilter, labelFilter]);

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
              statusFilter === null && labelFilter === null
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
          {usedLabels.length > 0 && (
            <span className="text-muted-foreground/40 text-xs mx-1">|</span>
          )}
          {usedLabels.map((label) => (
            <button
              key={label.id}
              onClick={() => setLabelFilter(labelFilter === label.id ? null : label.id)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border font-medium transition-colors",
                labelFilter === label.id
                  ? "opacity-100"
                  : "opacity-60 hover:opacity-100"
              )}
              style={{
                borderColor: label.color,
                backgroundColor: labelFilter === label.id ? `${label.color}33` : `${label.color}11`,
                color: label.color,
              }}
            >
              {label.name}
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
                  {(project.labels ?? []).length > 0 && (
                    <div className="hidden sm:flex items-center gap-1">
                      {(project.labels ?? []).slice(0, 2).map((label) => (
                        <span
                          key={label.id}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border"
                          style={{
                            borderColor: label.color,
                            backgroundColor: `${label.color}22`,
                            color: label.color,
                          }}
                        >
                          {label.name}
                        </span>
                      ))}
                      {(project.labels ?? []).length > 2 && (
                        <span className="text-xs text-muted-foreground">
                          +{(project.labels ?? []).length - 2}
                        </span>
                      )}
                    </div>
                  )}
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
