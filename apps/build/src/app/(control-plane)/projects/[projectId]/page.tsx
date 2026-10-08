import { notFound } from "next/navigation";

import { ProjectPage } from "@/features/deploy/components/deployments/project-page";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const id = Number(projectId);
  if (!Number.isSafeInteger(id)) notFound();

  return (
    <ProjectPage
      projectId={id}
      backHref="/projects"
      backLabel="Projects"
      tabBaseHref={`/projects/${projectId}`}
    />
  );
}
