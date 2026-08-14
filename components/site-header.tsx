"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { DemoUser, UserRole } from "@/lib/domain";

export function SiteHeader() {
  const pathname = usePathname();
  const onProfessorPage = pathname.startsWith("/professor");
  const onAdminPage = pathname.startsWith("/admin");
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [identity, setIdentity] = useState<DemoUser | null>(null);
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo/identity")
      .then((response) => response.json())
      .then((data: { users?: DemoUser[]; identity?: DemoUser | null }) => {
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
    <header className="site-header">
      <Link href={onAdminPage ? "/admin" : onProfessorPage ? "/professor" : "/"} className="brand" aria-label="Socratic Digital Twin home">
        <span className="brand-mark">S</span>
        <span><strong>Socratic</strong><small>Digital Twin Tutor</small></span>
      </Link>
      <div className="institution"><span>NUS</span><small>Faculty of Dentistry · POC</small></div>
      <nav className="header-actions" aria-label="Demo identity selector">
        <div className="role-menu">
          <button className="role-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {identity?.role === "admin" ? <ShieldCheck size={17} /> : identity?.role === "professor" ? <GraduationCap size={17} /> : <UserRound size={17} />}
            <span>{identity?.name ?? (onAdminPage ? "Admin identity" : onProfessorPage ? "Professor identity" : "Student identity")}</span>
          </button>
          {open ? (
            <div className="role-popover">
              <span>Demo identity</span>
              {users.map((user) => <button key={user.id} disabled={Boolean(switchingUserId)} onClick={() => void switchUser(user.id, user.role)}>{switchingUserId === user.id ? <LoaderCircle size={16} className="spin" /> : user.role === "admin" ? <ShieldCheck size={16} /> : user.role === "professor" ? <GraduationCap size={16} /> : <UserRound size={16} />} {user.name} <small>{switchingUserId === user.id ? "switching…" : user.role}</small></button>)}
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
