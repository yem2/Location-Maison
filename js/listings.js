(function (app) {
  app.initListings = function () {
    const properties = app.properties;
    const grid = document.querySelector("#property-grid");
    if (!grid) return;
    const emptyState = document.querySelector("#empty-state");
    const resultsCount = document.querySelector("#results-count");
    const searchForm = document.querySelector("#search-form");
    const locationFilter = document.querySelector("#location-filter");
    const typeFilter = document.querySelector("#type-filter");
    const priceFilter = document.querySelector("#price-filter");
    const roomsFilter = document.querySelector("#rooms-filter");
    const currencyFilter = document.querySelector("#currency-filter");
    const sortSelect = document.querySelector("#sort-select");
    const favoritesFilter = document.querySelector("#favorites-filter");
    const favoritesCount = document.querySelector("#favorites-count");
    const headerFavoritesCount = document.querySelector("#header-favorites-count");
    const compareToggle = document.querySelector("#compare-toggle");
    const compareCount = document.querySelector("#compare-count");
    const compareDialog = document.querySelector("#compare-dialog");
    const compareResults = document.querySelector("#compare-results");
    const tabs = [...document.querySelectorAll(".filter-tab")];
    const propertyDialog = document.querySelector("#property-dialog");
    const propertyDetail = document.querySelector("#property-detail");
    const defaultOperation = document.body.dataset.operation || "all";
    const defaultFavoritesOnly = document.body.dataset.favoritesOnly === "true";
    let activeOperation = defaultOperation;
    let favoritesOnly = defaultFavoritesOnly;
    let activeFeature = "";
    const compared = new Set();
    tabs.forEach((tab) => {
      const selected = tab.dataset.filter === activeOperation;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-pressed", String(selected));
    });
    favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));

    function normalize(value) {
      return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
    }

    // Taux de conversion approximatifs vers EUR (base)
    const rates = { EUR: 1, USD: 0.92, XAF: 0.00152, MAD: 0.092, CHF: 1.05, CAD: 0.68, GBP: 1.17, AED: 0.25 };

    function getSelectedCurrency() {
      if (!currencyFilter) return null;
      const opt = currencyFilter.options[currencyFilter.selectedIndex];
      return { code: opt.value, symbol: opt.dataset.symbol || opt.value };
    }

    function formatPrice(property) {
      const sel = getSelectedCurrency();
      if (sel && sel.code !== property.currency) {
        // Convertit le prix de la devise du bien vers la devise sélectionnée
        const inEur = property.price * (rates[property.currency] || 1);
        const converted = inEur / (rates[sel.code] || 1);
        const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
        return `${fmt.format(Math.round(converted))} ${sel.symbol}${property.priceSuffix || ""} <small style="color:var(--muted);font-size:11px;font-weight:400">(${new Intl.NumberFormat("fr-FR").format(property.price)} ${property.currencySymbol})</small>`;
      }
      return `${new Intl.NumberFormat("fr-FR").format(property.price)} ${property.currencySymbol || "€"}${property.priceSuffix || ""}`;
    }

    function visibleProperties() {
      const terms = normalize(locationFilter.value).split(/\s+/).filter(Boolean);
      const favorites = app.getFavorites();
      return properties
        .filter((property) => activeOperation === "all" || property.operation === activeOperation)
        .filter((property) => terms.every((term) => normalize(property.location).includes(term)))
        .filter((property) => typeFilter.value === "all" || property.kind === typeFilter.value)
        .filter((property) => !priceFilter.value || (() => {
          const sel = getSelectedCurrency();
          if (!sel || sel.code === property.currency) return property.price <= Number(priceFilter.value);
          const inEur = property.price * (rates[property.currency] || 1);
          const converted = inEur / (rates[sel.code] || 1);
          return converted <= Number(priceFilter.value);
        })())
        .filter((property) => property.rooms >= Number(roomsFilter.value))
        .filter((property) => !favoritesOnly || favorites.has(property.id))
        .filter((property) => !activeFeature || property.features.some((feature) => normalize(feature) === activeFeature))
        .sort((first, second) => {
          if (sortSelect.value === "price-asc") return first.price - second.price;
          if (sortSelect.value === "price-desc") return second.price - first.price;
          return first.order - second.order;
        });
    }

    function render() {
      const favorites = app.getFavorites();
      const results = visibleProperties();
      favoritesCount.textContent = String(favorites.size);
      if (headerFavoritesCount) headerFavoritesCount.textContent = String(favorites.size);
      if (compareCount) compareCount.textContent = String(compared.size);
      if (compareToggle) compareToggle.disabled = compared.size < 2;
      const noun = results.length > 1 ? "biens trouvés" : "bien trouvé";
      resultsCount.textContent = activeFeature
        ? `${results.length} ${noun} avec « ${activeFeature} » · Effacez les filtres pour tout revoir.`
        : `${results.length} ${noun}`;

      grid.innerHTML = results.map((property) => `
        <article class="property-card col">
          <div class="property-image">
            <img src="${property.image}" alt="${property.alt}" width="1400" height="933" loading="lazy" decoding="async">
            <span class="property-badge">${property.label}</span>
            <button class="favorite-button" type="button" data-favorite="${property.id}"
              aria-label="${favorites.has(property.id) ? 'Retirer des' : 'Ajouter aux'} favoris : ${property.title}"
              aria-pressed="${favorites.has(property.id)}">♡</button>
          </div>
          <div class="property-info">
            <p class="property-location">${property.location}</p>
            <h3 class="property-name">${property.title}</h3>
            <div class="property-details"><span>${property.rooms} pièces</span><span>${property.area} m²</span><span>${property.kindLabel}</span></div>
            <div class="property-bottom">
              <span class="property-price">${formatPrice(property)}</span>
              <span class="property-type">${property.operation === "sale" ? "Vente" : "Location"}</span>
            </div>
            <button class="compare-property" type="button" data-compare="${property.id}" aria-pressed="${compared.has(property.id)}">${compared.has(property.id) ? "✓ Ajouté au comparateur" : "＋ Comparer"}</button>
            <button class="details-button" type="button" data-details="${property.id}">Voir le détail <span aria-hidden="true">→</span></button>
          </div>
        </article>
      `).join("");
      emptyState.hidden = results.length > 0;
      grid.hidden = results.length === 0;
    }

    function setOperation(operation) {
      activeOperation = operation;
      activeFeature = "";
      tabs.forEach((tab) => {
        const selected = tab.dataset.filter === operation;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      render();
    }

    function resetFilters() {
      searchForm.reset();
      favoritesOnly = defaultFavoritesOnly;
      activeFeature = "";
      favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
      setOperation(defaultOperation);
    }

    function filterByFeature(feature) {
      activeFeature = normalize(feature);
      activeOperation = "all";
      favoritesOnly = false;
      favoritesFilter.setAttribute("aria-pressed", "false");
      searchForm.reset();
      tabs.forEach((tab) => {
        const selected = tab.dataset.filter === "all";
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      render();
      propertyDialog.close();
      document.querySelector("#annonces").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function showDetails(property) {
      const features = property.features.map((feature) => `
        <li><button class="feature-link" type="button" data-feature="${feature}">${feature}<span aria-hidden="true"> ↗</span></button></li>
      `).join("");
      propertyDetail.innerHTML = `
        <img class="dialog-image" src="${property.image}" alt="${property.alt}" width="1400" height="933" decoding="async">
        <div class="dialog-content">
          <p class="property-location">${property.location} · ${property.kindLabel}</p>
          <h2 id="dialog-title">${property.title}</h2>
          <p class="dialog-price">${formatPrice(property)}</p>
          <div class="dialog-stats">
            <span><strong>${property.rooms}</strong> pièces</span>
            <span><strong>${property.bedrooms}</strong> chambres</span>
            <span><strong>${property.bathrooms}</strong> salle${property.bathrooms > 1 ? "s" : ""} de bain</span>
            <span><strong>${property.area}</strong> m²</span>
          </div>
          <p class="dialog-description">${property.description}</p>
          <h3>Les petits plus — cliquez pour trouver un bien similaire</h3>
          <ul class="feature-list">${features}</ul>
          <div class="detail-actions">
            <button class="outline-button share-property" type="button" data-share="${property.id}">Partager ce bien <span aria-hidden="true">↗</span></button>
            <p class="share-feedback" role="status" hidden></p>
          </div>
          <button class="search-button dialog-contact" type="button" data-inquire="${property.id}">Demander des informations <span aria-hidden="true">↗</span></button>
        </div>
      `;
      propertyDialog.showModal();
    }

    tabs.forEach((tab) => tab.addEventListener("click", () => setOperation(tab.dataset.filter)));
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      render();
      setTimeout(() => {
        const target = document.querySelector("#results-count") || document.querySelector("#property-grid");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });
    searchForm.addEventListener("input", render);
    searchForm.addEventListener("change", render);
    if (currencyFilter) currencyFilter.addEventListener("change", render);
    sortSelect.addEventListener("change", render);
    document.querySelector("#reset-filters").addEventListener("click", resetFilters);
    const emptyReset = document.querySelector("#empty-reset");
    if (emptyReset) emptyReset.addEventListener("click", resetFilters);

    favoritesFilter.addEventListener("click", () => {
      favoritesOnly = !favoritesOnly;
      favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
      render();
    });

    if (compareToggle && compareDialog && compareResults) {
      compareToggle.addEventListener("click", () => {
        const selected = properties.filter((property) => compared.has(property.id));
        compareResults.innerHTML = `
          <div class="comparison-table">
            <div class="comparison-row comparison-heading"><span>Critère</span>${selected.map((property) => `<strong>${property.title}</strong>`).join("")}</div>
            <div class="comparison-row"><span>Prix</span>${selected.map((property) => `<span>${formatPrice(property)}</span>`).join("")}</div>
            <div class="comparison-row"><span>Localisation</span>${selected.map((property) => `<span>${property.location}</span>`).join("")}</div>
            <div class="comparison-row"><span>Type</span>${selected.map((property) => `<span>${property.kindLabel}</span>`).join("")}</div>
            <div class="comparison-row"><span>Pièces</span>${selected.map((property) => `<span>${property.rooms}</span>`).join("")}</div>
            <div class="comparison-row"><span>Chambres</span>${selected.map((property) => `<span>${property.bedrooms}</span>`).join("")}</div>
            <div class="comparison-row"><span>Surface</span>${selected.map((property) => `<span>${property.area} m²</span>`).join("")}</div>
          </div>
        `;
        compareDialog.showModal();
      });
    }

    grid.addEventListener("click", (event) => {
      const favoriteButton = event.target.closest("[data-favorite]");
      if (favoriteButton) {
        const favorites = app.getFavorites();
        const id = favoriteButton.dataset.favorite;
        if (favorites.has(id)) favorites.delete(id);
        else favorites.add(id);
        app.saveFavorites(favorites);
        render();
        return;
      }
      const detailsButton = event.target.closest("[data-details]");
      if (detailsButton) {
        const property = properties.find((item) => item.id === detailsButton.dataset.details);
        if (property) showDetails(property);
        return;
      }

      const compareButton = event.target.closest("[data-compare]");
      if (compareButton) {
        const id = compareButton.dataset.compare;
        if (compared.has(id)) compared.delete(id);
        else if (compared.size < 3) compared.add(id);
        else {
          resultsCount.textContent = "Vous pouvez comparer jusqu’à 3 biens à la fois.";
          return;
        }
        render();
      }
    });

    propertyDetail.addEventListener("click", (event) => {
      const featureButton = event.target.closest("[data-feature]");
      if (featureButton) {
        filterByFeature(featureButton.dataset.feature);
        return;
      }
      const shareButton = event.target.closest("[data-share]");
      if (shareButton) {
        const property = properties.find((item) => item.id === shareButton.dataset.share);
        if (property) {
          const shareData = {
            title: property.title,
            text: `${property.title} — ${property.location}, ${formatPrice(property)}`,
            url: new URL(`?bien=${encodeURIComponent(property.id)}`, window.location.href).href
          };
          const feedback = propertyDetail.querySelector(".share-feedback");
          const showShareLink = () => {
            let link = propertyDetail.querySelector(".share-link");
            if (!link) {
              link = document.createElement("a");
              link.className = "share-link";
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              feedback.after(link);
            }
            link.href = shareData.url;
            link.textContent = shareData.url;
            link.hidden = false;
          };
          (async () => {
            try {
              if (navigator.share) {
                await navigator.share(shareData);
                feedback.textContent = "Lien partagé.";
              } else if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareData.url);
                feedback.textContent = "Lien copié dans le presse-papiers.";
              } else {
                feedback.textContent = "Utilisez ce lien pour partager le bien :";
                showShareLink();
              }
              feedback.hidden = false;
            } catch (error) {
              if (error.name !== "AbortError") {
                feedback.textContent = "Le partage automatique est indisponible. Utilisez ce lien :";
                showShareLink();
                feedback.hidden = false;
              }
            }
          })();
        }
        return;
      }
      const inquiryButton = event.target.closest("[data-inquire]");
      if (inquiryButton) {
        const property = properties.find((item) => item.id === inquiryButton.dataset.inquire);
        if (property) app.openContact(property);
      }
    });

    propertyDialog.addEventListener("click", (event) => {
      if (event.target === propertyDialog) propertyDialog.close();
    });
    if (compareDialog) {
      compareDialog.addEventListener("click", (event) => {
        if (event.target === compareDialog) compareDialog.close();
      });
    }

    document.querySelectorAll("[data-nav-type]").forEach((link) => {
      link.addEventListener("click", () => setOperation(link.dataset.navType));
    });

    render();
    const sharedPropertyId = new URLSearchParams(window.location.search).get("bien");
    const sharedProperty = properties.find((property) => property.id === sharedPropertyId);
    if (sharedProperty) showDetails(sharedProperty);
  };
})(window.Maison);
