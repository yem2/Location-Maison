/* ============================================================
   features.js — Fonctionnalités ajoutées au site
   ------------------------------------------------------------
   1. Bandeau défilant (marquee) injecté sur la page d'accueil
   2. Bouton "Retour en haut" qui apparaît après le défilement
   3. Toast de confirmation (remplace les alertes intrusives)
   4. Badge "Nouveau" sur les annonces marquées isNew dans data.js
   5. Raccourci clavier : appuyez sur "f" pour filtrer les favoris
   Chaque fonction vérifie que l'élément existe avant d'agir,
   donc le script fonctionne sans erreur sur toutes les pages.
   ============================================================ */
(function (app) {
  "use strict";

  /* ---------- Utilitaire : toast de confirmation ---------- */
  // Crée (une seule fois) un petit message animé en bas de l'écran.
  let toastElement = null;
  let toastTimer = null;

  app.showToast = function (message) {
    if (!toastElement) {
      toastElement = document.createElement("div");
      toastElement.className = "toast";
      toastElement.setAttribute("role", "status");
      document.body.appendChild(toastElement);
    }
    toastElement.textContent = message;
    toastElement.classList.add("is-visible");
    // Le toast disparaît tout seul après 2,6 secondes
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove("is-visible"), 2600);
  };

  /* ---------- 1. Bandeau défilant de la page d'accueil ----- */
  // Inséré juste après le héros si la page contient la section .hero
  function initMarquee() {
    const hero = document.querySelector(".hero");
    if (!hero) return; // pas sur la page d'accueil : on ne fait rien

    const marquee = document.createElement("div");
    marquee.className = "marquee";
    marquee.setAttribute("aria-hidden", "true"); // décoratif pour les lecteurs d'écran
    // Le contenu est doublé pour que l'animation de défilement soit continue
    const items = [
      "Maisons avec jardin", "Appartements lumineux", "Villas avec piscine",
      "Lofts de caractère", "Duplex avec terrasse", "Biens sélectionnés avec soin"
    ];
    const line = items.map((item) => `<li>${item}</li>`).join("");
    marquee.innerHTML = `<ul class="marquee-track">${line}${line}</ul>`;
    hero.after(marquee);
  }

  /* ---------- 2. Bouton "Retour en haut" ------------------- */
  function initBackToTop() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "back-to-top";
    button.setAttribute("aria-label", "Revenir en haut de la page");
    button.textContent = "↑";
    document.body.appendChild(button);
   
    // Affiche le bouton seulement quand on a défilé de 500px
    const toggleVisibility = () => {
      button.classList.toggle("is-visible", window.scrollY > 500);
    };
    window.addEventListener("scroll", toggleVisibility, { passive: true });
    toggleVisibility();

    button.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- 4. Badges "Nouveau / Exclusivité" ------------ */
  // Les annonces avec isNew: true dans js/data.js reçoivent un badge.
  // On intercepte le rendu des cartes via un observateur du tableau.
  function decorateCards() {
    document.querySelectorAll("#property-grid .property-card").forEach((card) => {
      if (card.querySelector(".novelty-badge")) return; // déjà décorée
      const detailsButton = card.querySelector("[data-details]");
      if (!detailsButton) return;
      const property = app.properties.find((item) => item.id === detailsButton.dataset.details);
      if (!property || !property.isNew) return;
      const image = card.querySelector(".property-image");
      if (!image) return;
      const badge = document.createElement("span");
      badge.className = "novelty-badge" + (property.isExclusive ? "" : " is-new");
      badge.textContent = property.isExclusive ? "Exclusivité" : "Nouveau";
      image.appendChild(badge);
    });
  }
  app.decorateCards = decorateCards;

  /* ---------- 5. Raccourci clavier pour les favoris -------- */
  function initShortcut() {
    const favoritesFilter = document.querySelector("#favorites-filter");
    if (!favoritesFilter) return;
    document.addEventListener("keydown", (event) => {
      // "f" clique sur le filtre favoris, sauf si on tape dans un champ
      if (event.key !== "f" && event.key !== "F") return;
      const tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      favoritesFilter.click();
    });
  }

  /* ---------- Démarrage ------------------------------------ */
  app.initFeatures = function () {
    initMarquee();
    initBackToTop();
    initShortcut();
    decorateCards();
    const grid = document.querySelector("#property-grid");
    if (grid) {
      new MutationObserver(decorateCards).observe(grid, { childList: true });
    }

    // Header scroll effect
    const header = document.querySelector(".site-header");
    if (header) {
      const toggleScrolled = () => header.classList.toggle("scrolled", window.scrollY > 30);
      window.addEventListener("scroll", toggleScrolled, { passive: true });
      toggleScrolled();
    }

    // Reveal au scroll (Intersection Observer)
    const reveals = document.querySelectorAll(".reveal");
    if (reveals.length) {
      const observer = new IntersectionObserver(
        (entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }),
        { threshold: 0.12 }
      );
      reveals.forEach((el) => observer.observe(el));
    }
  };
})(window.Maison);
