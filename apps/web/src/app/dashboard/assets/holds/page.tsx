import { HoldsManagementPage } from '../../../../features/holds/holds-management-page';
import { requireSession } from '../../../../lib/server-session';

export default async function HoldsPage() {
  const session = await requireSession();
  return <HoldsManagementPage session={session} />;
}
