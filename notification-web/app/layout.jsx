import "./globals.css";

export const metadata = {
  title: "Courrier — Plateforme de notifications",
  description: "Console de pilotage des notifications email et SMS.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
