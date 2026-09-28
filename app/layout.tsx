import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ResolveProvider } from "@/lib/store";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Resolve — Receivables resolution",
  description: "Razorpay's Receivables Agent chases payment. Resolve fixes what's preventing it. Prototype for the Razorpay AI x PM Build Challenge.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <ResolveProvider>
          <AppShell>{children}</AppShell>
        </ResolveProvider>
      </body>
    </html>
  );
}
