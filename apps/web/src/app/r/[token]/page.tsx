import { PublicRouteFeedbackPage } from '../../../features/routes/public-route-feedback-page';

export default async function RouteFeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <PublicRouteFeedbackPage token={(await params).token} />;
}
