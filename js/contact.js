(function (app) {
  app.initContact = function () {
    const form = document.querySelector("#contact-form");
    const dialog = document.querySelector("#contact-dialog");
    const propertyDialog = document.querySelector("#property-dialog");
    if (!form || !dialog) return;
    const context = document.querySelector("#contact-context");
    const feedback = document.querySelector("#contact-feedback");
    const whatsappLink = document.querySelector("#whatsapp-link");

    document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
      link.href = `https://wa.me/${app.whatsappPhone}?text=${encodeURIComponent("Bonjour, je vous contacte depuis votre site.")}`;
    });
    document.querySelectorAll('[data-facebook-link], [aria-label="Facebook"]').forEach((link) => { link.href = app.facebookUrl; });
    document.querySelectorAll('[data-instagram-link], [aria-label="Instagram"]').forEach((link) => { link.href = app.instagramUrl; });

    app.openContact = function (property) {
      if (propertyDialog && propertyDialog.open) propertyDialog.close();
      form.reset();
      feedback.hidden = true;
      whatsappLink.hidden = true;
      context.textContent = property
        ? `Votre message concernera « ${property.title} », à ${property.location}.`
        : "Laissez-nous un message, nous vous répondrons rapidement.";
      form.dataset.propertyTitle = property ? property.title : "";
      dialog.showModal();
      form.querySelector('input[name="name"]').focus();
    };

    document.querySelectorAll("[data-open-contact]").forEach((button) => {
      button.addEventListener("click", () => app.openContact(null));
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const title = form.dataset.propertyTitle;
      const message = [
        `Bonjour, je m’appelle ${data.get("name")}.`,
        `Mon e-mail : ${data.get("email")}`,
        data.get("phone") ? `Mon téléphone : ${data.get("phone")}` : "",
        title ? `Bien concerné : ${title}` : "",
        "",
        data.get("message")
      ].filter(Boolean).join("\n");
      // Enregistre la demande dans la base (sans bloquer l'ouverture de WhatsApp)
      fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), email: data.get("email"), phone: data.get("phone") || "", property: form.dataset.propertyTitle || "", message: data.get("message") })
      }).catch(() => {});
      const url = `https://wa.me/${app.whatsappPhone}?text=${encodeURIComponent(message)}`;

      whatsappLink.href = url;
      whatsappLink.textContent = "Cliquer ici pour ouvrir WhatsApp et envoyer le message";
      whatsappLink.hidden = false;
      feedback.textContent = "Votre message est prêt. WhatsApp va s’ouvrir ; vérifiez le texte puis appuyez sur Envoyer.";
      feedback.hidden = false;

      const whatsappWindow = window.open(url, "_blank");
      if (!whatsappWindow) {
        feedback.textContent = "La fenêtre WhatsApp a été bloquée. Cliquez sur le lien ci-dessous pour continuer.";
      } else {
        whatsappWindow.opener = null;
      }
    });
  };
})(window.Maison);
