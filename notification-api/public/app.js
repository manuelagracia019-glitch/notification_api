const form = document.querySelector("#email-form");
const submitButton = document.querySelector("#submit-button");
const apiStatus = document.querySelector("#api-status");
const apiIndicator = document.querySelector("#api-indicator");
const result = document.querySelector("#result");
const resultIcon = document.querySelector("#result-icon");
const resultTitle = document.querySelector("#result-title");
const resultMessage = document.querySelector("#result-message");
const resultDetails = document.querySelector("#result-details");

async function checkApi() {
  try {
    const response = await fetch("/health");
    if (!response.ok) {
      throw new Error("API indisponible");
    }

    apiStatus.textContent = "API connectée";
    apiIndicator.classList.add("is-online");
  } catch {
    apiStatus.textContent = "API indisponible";
    apiIndicator.classList.add("is-offline");
  }
}

function showResult({ success, title, message, details = "" }) {
  result.className = `result ${success ? "success" : "error"}`;
  resultIcon.textContent = success ? "✓" : "!";
  resultTitle.textContent = title;
  resultMessage.textContent = message;
  resultDetails.textContent = details;
  resultDetails.hidden = !details;
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  const formData = new FormData(form);
  const payload = {
    to: formData.get("to").trim(),
    subject: formData.get("subject").trim(),
    text: formData.get("text").trim(),
  };
  const apiToken = formData.get("apiToken").trim();

  if (!apiToken || !payload.subject || !payload.text) {
    showResult({
      success: false,
      title: "Champs manquants",
      message: "Veuillez renseigner le jeton API, l’objet et le contenu du message.",
    });
    return;
  }

  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  submitButton.setAttribute("aria-busy", "true");
  result.hidden = true;

  try {
    const response = await fetch("/api/notifications/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || `L’envoi a échoué (HTTP ${response.status}).`);
    }

    const accepted = Array.isArray(data.data?.accepted) ? data.data.accepted.join(", ") : "";
    const messageId = data.data?.messageId ? `ID du message : ${data.data.messageId}` : "";
    const details = [accepted ? `Accepté par Gmail : ${accepted}` : "", messageId]
      .filter(Boolean)
      .join(" · ");

    showResult({
      success: true,
      title: "Email envoyé",
      message: `Votre message a été transmis à ${payload.to}.`,
      details,
    });
  } catch (error) {
    showResult({
      success: false,
      title: "Échec de l’envoi",
      message: error instanceof Error ? error.message : "Une erreur inattendue est survenue.",
    });
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
    submitButton.removeAttribute("aria-busy");
  }
});

document.querySelector("#dismiss-result").addEventListener("click", () => {
  result.hidden = true;
});

checkApi();
