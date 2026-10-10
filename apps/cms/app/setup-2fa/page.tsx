import { redirect } from "next/navigation";
import { AuthCard } from "../../components/auth-card";
import { getSession } from "../../lib/auth";
import { SetupTwoFactor } from "./setup-two-factor";

export const dynamic = "force-dynamic";

export default async function SetupTwoFactorPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.twoFactorEnabled) redirect("/");
  return (
    <AuthCard title="Set up two-factor authentication" subtitle="Required for every CMS account.">
      <SetupTwoFactor />
    </AuthCard>
  );
}
