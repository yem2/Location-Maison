(function (app) {
  const storageKey = "maison-favorites";

  app.getFavorites = function () {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return new Set(Array.isArray(saved) ? saved : []);
    } catch (error) {
      console.warn("Les favoris enregistrés n’ont pas pu être lus.", error);
      return new Set();
    }
  };

  app.saveFavorites = function (favorites) {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...favorites]));
      return true;
    } catch (error) {
      console.error("Impossible d’enregistrer vos favoris dans ce navigateur.", error);
      return false;
    }
  };
})(window.Maison);
