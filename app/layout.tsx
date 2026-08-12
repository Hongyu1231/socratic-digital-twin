import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: { default: "Socratic Digital Twin", template: "%s · Socratic Digital Twin" },
    description: "A proof of concept for teaching dental clinical reasoning through Socratic questioning.",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Socratic Digital Twin",
      description: "Learn to think. Not just answer.",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Socratic Digital Twin clinical reasoning tutor" }],
    },
    twitter: { card: "summary_large_image", title: "Socratic Digital Twin", description: "Learn to think. Not just answer.", images: ["/og.png"] },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#21162d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
