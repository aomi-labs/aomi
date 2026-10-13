import { createFileRoute, notFound } from "@tanstack/react-router";

import { ProjectPage } from "@/features/deploy/components/deployments/project-page";

export const Route = createFileRoute("/_control/projects/$projectId")({
  beforeLoad: ({ params }) => {
    if (!Number.isSafeInteger(Number(params.projectId))) throw notFound();
  },
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const params = Route.useParams();
  const { projectId } = params;
  const id = Number(projectId);

  return (
    <ProjectPage
      projectId={id}
      backHref="/projects"
      backLabel="Projects"
      tabBaseHref={`/projects/${projectId}`}
    />
  );
}
