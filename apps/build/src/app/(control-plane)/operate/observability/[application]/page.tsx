import { notFound } from "next/navigation";
import { AppDetailPage } from "@/features/operate/app-detail-page";

type PageProps = {
  params: Promise<{ application: string }>;
};

export default async function OperateObservabilityDetailPage({
  params,
}: PageProps) {
  const { application } = await params;
  const applicationId = Number(application);
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    notFound();
  }

  return <AppDetailPage applicationId={applicationId} />;
}
