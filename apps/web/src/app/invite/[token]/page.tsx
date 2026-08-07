import { InvitationAcceptancePage } from '../../../features/team/invitation-acceptance-page';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationAcceptancePage token={token} />;
}
