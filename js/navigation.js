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
