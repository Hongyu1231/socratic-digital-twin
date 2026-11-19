"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LoaderCircle, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { signOut } from "@/app/auth-actions";
import type { PublicDemoIdentity, UserRole } from "@/lib/domain";

type HeaderIdentity = Pick<PublicDemoIdentity, "name" | "role">;

function RoleIcon({ role, size }: { role?: UserRole; size: number }) {
  return role === "admin" ? <ShieldCheck size={size} /> : role === "professor" ? <GraduationCap size={size} /> : <UserRound size={size} />;
}

export function SiteHeader({ demoMode, identity }: { demoMode: boolean; identity: HeaderIdentity | null }) {
  const pathname = usePathname();
  const onProfessorPage = pathname.startsWith("/professor");
  const onAdminPage = pathname.startsWith("/admin");
  return (
    <header className="site-header">
      <Link href={onAdminPage ? "/admin" : onProfessorPage ? "/professor" : "/"} className="brand" aria-label="Socratic Digital Twin home">
        <span className="brand-mark">S</span>
        <span><strong>Socratic</strong><small>Digital Twin Tutor</small></span>
      </Link>
      <div className="institution"><span>NUS</span><small>Faculty of Dentistry · POC</small></div>
      {demoMode ? <DemoIdentitySwitcher onAdminPage={onAdminPage} onProfessorPage={onProfessorPage} /> : identity ? (
        <nav className="header-actions" aria-label="Account">
          <span className="signed-in-name"><RoleIcon role={identity.role} size={17} />{identity.name}</span>
          <form action={signOut}>
            <button className="sign-out-button" type="submit"><LogOut size={15} /> Sign out</button>
          </form>
        </nav>
      ) : <span />}
    </header>
  );
}

function DemoIdentitySwitcher({ onAdminPage, onProfessorPage }: { onAdminPage: boolean; onProfessorPage: boolean }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<PublicDemoIdentity[]>([]);
  const [identity, setIdentity] = useState<PublicDemoIdentity | null>(null);
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo/identity")
      .then((response) => response.json())
      .then((data: { users?: PublicDemoIdentity[]; identity?: PublicDemoIdentity | null }) => {
        setUsers(data.users ?? []);
        setIdentity(data.identity ?? null);
      })
      .catch(() => undefined);
  }, []);

  async function switchUser(userId: string, role: UserRole) {
    if (switchingUserId) return;
    setSwitchingUserId(userId);
    try {
      const response = await fetch("/api/demo/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) window.location.assign(role === "admin" ? "/admin" : role === "professor" ? "/professor" : "/");
    } finally {
      setSwitchingUserId(null);
    }
  }

  return (
      <nav className="header-actions" aria-label="Demo identity selector">
        <div className="role-menu">
          <button className="role-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={identity?.name ?? "Choose demo identity"}>
            {identity?.role === "admin" ? <ShieldCheck size={17} /> : identity?.role === "professor" ? <GraduationCap size={17} /> : <UserRound size={17} />}
            <span>{identity?.name ?? (onAdminPage ? "Admin identity" : onProfessorPage ? "Professor identity" : "Student identity")}</span>
          </button>
          {open ? (
            <div className="role-popover">
              <span>Demo identity</span>
              <p>All demo roles are open. This is not production authentication; do not publish private records through this demo.</p>
              {users.map((user) => <button key={user.id} disabled={Boolean(switchingUserId)} onClick={() => void switchUser(user.id, user.role)}>{switchingUserId === user.id ? <LoaderCircle size={16} className="spin" /> : user.role === "admin" ? <ShieldCheck size={16} /> : user.role === "professor" ? <GraduationCap size={16} /> : <UserRound size={16} />} {user.name} <small>{switchingUserId === user.id ? "switching…" : user.role}</small></button>)}
            </div>
          ) : null}
        </div>
      </nav>
  );
}
