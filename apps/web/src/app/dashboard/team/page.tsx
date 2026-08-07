import { TeamManagementPage } from '../../../features/team/team-management-page';
import { requireSession } from '../../../lib/server-session';

export default async function TeamPage() {
  const session = await requireSession();
  return <TeamManagementPage session={session} />;
}
