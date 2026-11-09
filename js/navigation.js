(function (app) {
  app.initNavigation = function () {
    const menuButton = document.querySelector(".menu-toggle");
    const navigation = document.querySelector("#main-nav");

    menuButton.addEventListener("click", () => {
      const expanded = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!expanded));
      menuButton.setAttribute("aria-label", expanded ? "Ouvrir le menu" : "Fermer le menu");
      navigation.classList.toggle("is-open", !expanded);
    });

    navigation.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navigation.classList.remove("is-open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Ouvrir le menu");
      });
    });

    // Les pages de html/ utilisent <base href="../"> : on gère les ancres #... nous-mêmes
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      const id = link.getAttribute("href").slice(1);
      if (!id) return;
      link.addEventListener("click", (event) => {
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        if (target.tabIndex < 0) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      });
    });
    document.querySelectorAll(".dialog-close").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog").close());
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
  };
})(window.Maison);
