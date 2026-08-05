import type { Metadata } from "next"
import "./globals.css"
import Providers from "./providers"

// Env-driven so the origin moves with AUTH_URL rather than a code change.
// Mirrors lib/seo.ts so metadataBase and per-page canonicals cannot disagree.
const siteUrl = process.env.AUTH_URL?.replace(/\/$/, "") || "https://quaestron.io"

export const metadata: Metadata = {
  title: "Quaestron — Defense Market Intelligence",
  description:
    "Mapping the defense technology, cybersecurity, AI, and surveillance ecosystem. Track companies, investors, government contracts, and relationships.",
  keywords: [
    "defense tech",
    "cybersecurity",
    "surveillance",
    "OSINT",
    "government contracts",
    "defense industry",
  ],
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Quaestron — Defense Market Intelligence",
    description: "They build the weapons. It's time to map the arsenal. Track 1,700+ defense tech, cybersecurity, AI, and surveillance companies.",
    url: siteUrl,
    siteName: "Quaestron",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Quaestron — Mapping the Defense Tech Arsenal",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quaestron — Defense Market Intelligence",
    description: "They build the weapons. It's time to map the arsenal. Track 1,700+ defense tech, cybersecurity, AI, and surveillance companies.",
    images: ["/og-image.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Lexend:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
