import { createFileRoute } from "@tanstack/react-router";
import { notFound } from "@tanstack/react-router";

import { ProjectPage } from "@/features/deploy/components/deployments/project-page";

export const Route = createFileRoute("/_control/projects/$projectId")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const params = Route.useParams();
  const { projectId } = params;
  const id = Number(projectId);
  if (!Number.isSafeInteger(id)) throw notFound();

  return (
    <ProjectPage
      projectId={id}
      backHref="/projects"
      backLabel="Projects"
      tabBaseHref={`/projects/${projectId}`}
    />
  );
}
