import type { ReactNode } from "react";

export const metadata = {
  title: "JDM Kingdom eBay Tool",
  description: "Store sync, trend research and listing automation for the JDM Kingdom eBay store.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0b0d12",
          color: "#e8eaed",
        }}
      >
        {children}
      </body>
    </html>
  );
}
