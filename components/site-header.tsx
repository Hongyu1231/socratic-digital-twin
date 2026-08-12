"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { DemoUser, UserRole } from "@/lib/domain";

export function SiteHeader() {
  const pathname = usePathname();
  const onProfessorPage = pathname.startsWith("/professor");
  const onAdminPage = pathname.startsWith("/admin");
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => { fetch("/api/demo/identity").then((response) => response.json()).then((data) => setUsers(data.users ?? [])).catch(() => undefined); }, []);

  function switchUser(userId: string, role: UserRole) {
    startTransition(async () => {
      const response = await fetch("/api/demo/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) window.location.assign(role === "admin" ? "/admin" : role === "professor" ? "/professor" : "/");
    });
  }

  return (
    <header className="site-header">
      <Link href={onAdminPage ? "/admin" : onProfessorPage ? "/professor" : "/"} className="brand" aria-label="Socratic Digital Twin home">
        <span className="brand-mark">S</span>
        <span><strong>Socratic</strong><small>Digital Twin Tutor</small></span>
      </Link>
      <div className="institution"><span>NUS</span><small>Faculty of Dentistry · POC</small></div>
      <nav className="header-actions" aria-label="Primary navigation">
        <button className={onProfessorPage ? "nav-link active nav-button" : "nav-link nav-button"} onClick={() => { const user = users.find((item) => item.role === "professor"); if (user) switchUser(user.id, user.role); }}>Professor</button>
        <button className={onAdminPage ? "nav-link active nav-button" : "nav-link nav-button"} onClick={() => { const user = users.find((item) => item.role === "admin"); if (user) switchUser(user.id, user.role); }}>Admin</button>
        <div className="role-menu">
          <button className="role-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {onAdminPage ? <ShieldCheck size={17} /> : onProfessorPage ? <GraduationCap size={17} /> : <UserRound size={17} />}
            <span>{onAdminPage ? "Admin" : onProfessorPage ? "Professor" : "Student"}</span>
          </button>
          {open ? (
            <div className="role-popover">
              <span>Demo identity</span>
              {users.map((user) => <button key={user.id} disabled={pending} onClick={() => switchUser(user.id, user.role)}>{user.role === "admin" ? <ShieldCheck size={16} /> : user.role === "professor" ? <GraduationCap size={16} /> : <UserRound size={16} />} {user.name} <small>{user.role}</small></button>)}
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
