/* ============================================================
   script.js — Démarrage du site (chargé en dernier)
   Initialise dans l'ordre :
   1. le formulaire de contact (contact.js)
   2. les annonces et filtres (listings.js)
   3. le menu mobile et les fenêtres (navigation.js)
   4. les nouvelles fonctionnalités (features.js)
   5. la calculatrice de prêt si on est sur pret.html (loan.js)
   ============================================================ */
window.Maison.initContact();
window.Maison.initListings();
window.Maison.initNavigation();
window.Maison.initFeatures();

// Calculatrice de prêt : ne fait rien si les curseurs sont absents
if (window.Maison.initLoan) window.Maison.initLoan();

// Année dynamique dans le pied de page de chaque page
const yearElement = document.querySelector("#current-year");
if (yearElement) yearElement.textContent = new Date().getFullYear();
