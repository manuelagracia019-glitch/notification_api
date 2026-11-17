"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");

const navigation = [
  { id: "overview", label: "Vue d’ensemble", icon: "◫" },
  { id: "compose", label: "Nouvelle notification", icon: "＋" },
  { id: "history", label: "Historique", icon: "◷" },
  { id: "settings", label: "Configuration", icon: "⚙" },
];

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusPill({ status }) {
  const labels = { sent: "Envoyé", failed: "Échec", pending: "En cours" };
  return <span className={`status-pill status-${status}`}>{labels[status] || status}</span>;
}

export default function Dashboard() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [section, setSection] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(null);
  const [channel, setChannel] = useState("email");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || `Erreur HTTP ${response.status}`);
    }
    return payload.data;
  }, [token]);

  const refreshOverview = useCallback(async () => {
    const data = await request("/api/admin/overview");
    setOverview(data);
    setSettings(data.settings);
  }, [request]);

  useEffect(() => {
    const savedToken = window.sessionStorage.getItem("notification-admin-token");
    if (savedToken) {
      setToken(savedToken);
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (!authenticated || !token) return;
    refreshOverview().catch((error) => {
      setAuthenticated(false);
      window.sessionStorage.removeItem("notification-admin-token");
      setNotice({ type: "error", text: error.message });
    });
  }, [authenticated, token, refreshOverview]);

  useEffect(() => {
    if (!authenticated || section !== "history") return;
    request("/api/admin/notifications?limit=100")
      .then(setHistory)
      .catch((error) => setNotice({ type: "error", text: error.message }));
  }, [authenticated, request, section]);

  const filteredHistory = useMemo(() => historyFilter === "all"
    ? history
    : history.filter((item) => item.channel === historyFilter), [history, historyFilter]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Impossible de se connecter à l’API.");
      }
      window.sessionStorage.setItem("notification-admin-token", token);
      setOverview(payload.data);
      setSettings(payload.data.settings);
      setAuthenticated(true);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function submitNotification(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = channel === "email"
      ? {
          to: formData.get("to"),
          subject: formData.get("subject"),
          text: formData.get("content"),
        }
      : { to: formData.get("to"), body: formData.get("content") };
    setBusy(true);
    setNotice(null);
    try {
      const data = await request(`/api/notifications/${channel}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice({
        type: "success",
        text: `${channel === "email" ? "Email" : "SMS"} transmis avec succès · ${data.data?.messageId || data.messageId || "confirmation reçue"}`,
      });
      form.reset();
      await refreshOverview();
      if (section === "history") {
        setHistory(await request("/api/admin/notifications?limit=100"));
      }
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      await refreshOverview().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(provider, event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = Object.fromEntries(formData.entries());
    setBusy(true);
    setNotice(null);
    try {
      await request(`/api/admin/settings/${provider}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await refreshOverview();
      form.reset();
      setNotice({ type: "success", text: "Configuration enregistrée. Les secrets ne sont jamais renvoyés par l’API." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSettings(provider) {
    if (!window.confirm("Supprimer cette configuration ? Les identifiants enregistrés seront effacés et les variables d’environnement de ce fournisseur seront désactivées.")) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      await request(`/api/admin/settings/${provider}`, { method: "DELETE" });
      await refreshOverview();
      setNotice({ type: "success", text: "Configuration supprimée." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    window.sessionStorage.removeItem("notification-admin-token");
    setToken("");
    setAuthenticated(false);
    setOverview(null);
  }

  if (!authenticated) {
    return (
      <main className="login-page">
        <div className="login-card">
          <Brand />
          <span className="eyebrow">ESPACE ADMINISTRATEUR</span>
          <h1>Pilotez vos notifications.</h1>
          <p>Connectez-vous avec le jeton d’administration configuré sur le serveur API.</p>
          {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}
          <form onSubmit={login}>
            <label htmlFor="admin-token">Jeton d’administration</label>
            <input id="admin-token" type="password" autoComplete="current-password" value={token}
              onChange={(event) => setToken(event.target.value)} required />
            <button className="primary-button full-button" disabled={busy}>
              {busy ? "Connexion…" : "Ouvrir la plateforme"} <span>→</span>
            </button>
          </form>
          <small>Votre jeton reste dans cette session et n’est pas enregistré côté serveur.</small>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">ESPACE DE TRAVAIL</div>
        <nav aria-label="Navigation principale">
          {navigation.map((item) => (
            <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`}
              onClick={() => { setSection(item.id); setNotice(null); }}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === "history" && <span className="nav-count">{overview?.stats.total || 0}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="api-health"><span className="health-dot" /> API opérationnelle <span className="health-status">EN LIGNE</span></div>
          <button className="logout-button" onClick={logout}>↗ <span>Se déconnecter</span></button>
          <div className="sidebar-version">COURRIER PLATFORM <span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">Espace de travail <span>/</span> <strong>{navigation.find((item) => item.id === section)?.label}</strong></div>
          <div className="topbar-right"><span className="environment-tag">ESPACE ADMIN</span><span className="avatar">A</span></div>
        </header>
        <div className="page-content">
          {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
          {section === "overview" && <Overview overview={overview} onGo={setSection} />}
          {section === "compose" && (
            <section>
              <PageHeading eyebrow="CENTRE D’ENVOI" title="Nouvelle notification" description="Envoyez un email ou un SMS et suivez son statut depuis l’historique." />
              <div className="composer-card">
                <div className="channel-tabs" role="tablist">
                  <button className={channel === "email" ? "selected" : ""} onClick={() => setChannel("email")} type="button">✉ Email</button>
                  <button className={channel === "sms" ? "selected" : ""} onClick={() => setChannel("sms")} type="button">▣ SMS</button>
                </div>
                <form className="form-grid" onSubmit={submitNotification}>
                  <div className="field full"><label htmlFor="recipient">{channel === "email" ? "Adresse email" : "Numéro de téléphone"}</label>
                    <input id="recipient" name="to" type={channel === "email" ? "email" : "tel"} placeholder={channel === "email" ? "nom@exemple.com" : "+33 6 12 34 56 78"} required /></div>
                  {channel === "email" && <div className="field full"><label htmlFor="subject">Objet</label><input id="subject" name="subject" maxLength="200" placeholder="Objet de votre email" required /></div>}
                  <div className="field full"><label htmlFor="content">{channel === "email" ? "Message" : "Message SMS"}</label>
                    <textarea id="content" name="content" rows="6" maxLength={channel === "sms" ? 1600 : undefined} placeholder="Rédigez votre message…" required /></div>
                  {channel === "sms" && <div className="form-hint full">Les frais et limites dépendent de votre compte Vonage et du pays de destination.</div>}
                  <div className="form-actions full"><span className="form-hint">L’envoi utilise la configuration enregistrée sur le serveur.</span>
                    <button className="primary-button" disabled={busy}>{busy ? "Envoi…" : "Envoyer maintenant"} <span>→</span></button></div>
                </form>
              </div>
            </section>
          )}
          {section === "history" && (
            <section>
              <PageHeading eyebrow="JOURNAL DES ENVOIS" title="Historique" description="Les événements sont enregistrés dans PostgreSQL pour faciliter le suivi et le diagnostic." />
              <div className="table-card">
                <div className="table-toolbar"><strong>{history.length} notification{history.length === 1 ? "" : "s"}</strong>
                  <select aria-label="Filtrer par canal" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
                    <option value="all">Tous les canaux</option><option value="email">Email</option><option value="sms">SMS</option>
                  </select></div>
                <NotificationTable items={filteredHistory} />
              </div>
            </section>
          )}
          {section === "settings" && (
            <section>
              <PageHeading eyebrow="CONNEXIONS FOURNISSEURS" title="Configuration" description="Renseignez les identifiants utilisés par l’API. Les secrets sont chiffrés en base et masqués dans l’interface." />
              <div className="settings-grid">
                <ProviderCard key={`email-${settings?.email?.source}-${settings?.email?.sender}-${settings?.email?.configured}`} title="Email" provider="email" icon="✉" state={settings?.email} busy={busy} onSave={saveSettings} onDelete={deleteSettings}>
                  <label>Adresse Gmail<input name="user" type="email" defaultValue={settings?.email?.sender || ""} placeholder="vous@exemple.com" required /></label>
                  <label>Mot de passe d’application<input name="appPassword" type="password" placeholder="Laisser vide pour conserver le secret" autoComplete="new-password" required={!settings?.email?.configured} /></label>
                  <p>Utilisez un mot de passe d’application Google, pas le mot de passe de votre compte.</p>
                </ProviderCard>
                <ProviderCard key={`sms-${settings?.sms?.source}-${settings?.sms?.sender}-${settings?.sms?.configured}`} title="SMS · Vonage" provider="sms" icon="▣" state={settings?.sms} busy={busy} onSave={saveSettings} onDelete={deleteSettings}>
                  <label>Clé API<input name="apiKey" type="password" placeholder={settings?.sms?.configured ? "Configurée · laisser vide pour conserver" : "Clé API Vonage"} autoComplete="new-password" required={!settings?.sms?.configured} /></label>
                  <label>Secret API<input name="apiSecret" type="password" placeholder="Laisser vide pour conserver le secret" autoComplete="new-password" required={!settings?.sms?.configured} /></label>
                  <label>Expéditeur SMS<input name="sender" type="text" defaultValue={settings?.sms?.sender || ""} placeholder="Nom ou numéro autorisé" required={!settings?.sms?.configured} /></label>
                  <p>L’identifiant d’expéditeur doit être autorisé pour le compte et le pays ciblé.</p>
                </ProviderCard>
              </div>
              <div className="security-note"><span>◇</span><div><strong>Vos identifiants restent privés</strong><p>Les secrets sont chiffrés avec AES-256-GCM avant stockage. La clé SETTINGS_ENCRYPTION_KEY doit être conservée hors de la base de données.</p></div></div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return <div className="brand"><span className="brand-mark">✉</span><span>courrier<span className="brand-dot">.</span></span></div>;
}

function PageHeading({ eyebrow, title, description }) {
  return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}<span>.</span></h1><p>{description}</p></div>;
}

function Overview({ overview, onGo }) {
  const stats = overview?.stats || {};
  return (
    <section>
      <div className="welcome-row"><PageHeading eyebrow="VOTRE ACTIVITÉ" title="Bonjour, équipe." description="Voici le résumé de l’activité de votre plateforme de notification." />
        <button className="primary-button" onClick={() => onGo("compose")}>Créer un envoi <span>＋</span></button></div>
      <div className="stat-grid">
        <StatCard label="Notifications envoyées" value={stats.sent || 0} icon="↗" tone="orange" foot={`${stats.today || 0} aujourd’hui`} />
        <StatCard label="Total enregistré" value={stats.total || 0} icon="◷" tone="blue" foot={`${stats.failed || 0} échec${stats.failed === 1 ? "" : "s"}`} />
        <StatCard label="Emails" value={stats.email || 0} icon="✉" tone="purple" foot="Depuis le lancement" />
        <StatCard label="SMS" value={stats.sms || 0} icon="▣" tone="green" foot="Depuis le lancement" />
      </div>
      <div className="overview-grid">
        <div className="table-card recent-card"><div className="card-heading"><div><span className="eyebrow">ACTIVITÉ RÉCENTE</span><h2>Dernières notifications</h2></div><button className="text-button" onClick={() => onGo("history")}>Tout voir →</button></div>
          <NotificationTable items={overview?.recent || []} compact /></div>
        <div className="health-card"><span className="eyebrow">VOS CANAUX</span><h2>État des connexions</h2>
          <ProviderStatus title="Email · Gmail" state={overview?.settings?.email} icon="✉" />
          <ProviderStatus title="SMS · Vonage" state={overview?.settings?.sms} icon="▣" />
          <div className="database-status"><span className="database-icon">◈</span><div><strong>Base de données</strong><small>PostgreSQL · Historique activé</small></div><span className="connection-dot" /></div>
          <button className="outline-button" onClick={() => onGo("settings")}>Gérer les connexions <span>→</span></button>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, icon, tone, foot }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong>{value.toLocaleString("fr-FR")}</strong><small>{foot}</small></div>;
}

function ProviderStatus({ title, state, icon }) {
  const configured = Boolean(state?.configured);
  return <div className="provider-status"><span className="provider-icon">{icon}</span><div><strong>{title}</strong><small>{configured ? state.sender || "Configuration active" : "Configuration requise"}</small></div><span className={`connection-dot ${configured ? "" : "off"}`} /></div>;
}

function NotificationTable({ items, compact = false }) {
  if (!items.length) return <div className="empty-state"><span>◷</span><strong>Aucune notification pour le moment</strong><p>Les messages envoyés apparaîtront ici.</p></div>;
  return (
    <div className="table-scroll"><table><thead><tr><th>CANAL</th><th>DESTINATAIRE</th>{!compact && <th>OBJET / MESSAGE</th>}<th>STATUT</th><th>DATE</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><span className={`channel-badge ${item.channel}`}>{item.channel === "email" ? "✉ Email" : "▣ SMS"}</span></td>
        <td className="recipient-cell">{item.recipient}</td>{!compact && <td className="message-cell">{item.subject || item.content}</td>}
        <td><StatusPill status={item.status} /></td><td className="date-cell">{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div>
  );
}

function ProviderCard({ title, provider, icon, state, busy, onSave, onDelete, children }) {
  const sources = {
    database: "Enregistrée dans la base de données",
    environment: "Fournie par les variables d’environnement",
    mixed: "Configuration combinée",
    disabled: "Configuration désactivée",
    none: "Aucune configuration",
  };

  return <form className="provider-card" onSubmit={(event) => onSave(provider, event)}>
    <div className="provider-card-heading"><span className="provider-card-icon">{icon}</span><div><h2>{title}</h2><small>{state?.configured ? "Paramètres enregistrés" : "Non configuré"} · {sources[state?.source] || "Source inconnue"}</small></div><span className={`connection-dot ${state?.configured ? "" : "off"}`} /></div>
    <div className="provider-fields">{children}</div>
    <div className="provider-actions">
      <button className="outline-button save-button" disabled={busy}>Enregistrer la configuration <span>→</span></button>
      {state?.configured && <button className="delete-button" type="button" disabled={busy} onClick={() => onDelete(provider)}>Supprimer la configuration</button>}
    </div>
  </form>;
}
