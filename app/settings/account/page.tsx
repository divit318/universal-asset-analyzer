import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell, PageHeader } from "@/app/_components/ui";
import { currentUser } from "@/lib/auth";
import { AccountCard } from "../_components/account-card";
import { ChangePasswordCard } from "../_components/change-password-card";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/**
 * /settings/account — the local account's profile and password.
 *
 * Deliberately its own route beside /settings (which a concurrent workstream
 * owns for AI-key management) rather than a second writer to that file. A
 * server component so the signed-in check happens before paint: without a
 * session this page is meaningless, so it redirects to the landing page
 * regardless of whether the auth gate is on.
 */
export default async function AccountSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/landing");

  return (
    <PageShell gap="gap-6">
      <PageHeader
        title="Account"
        description="Your local UAA account — profile and credentials, stored in this machine's own database."
      />
      <div className="grid max-w-2xl grid-cols-1 items-start gap-6 lg:max-w-5xl lg:grid-cols-2">
        <AccountCard initialUser={user} />
        <ChangePasswordCard email={user.email} />
      </div>
    </PageShell>
  );
}
