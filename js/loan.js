/* ============================================================
   loan.js — Calculatrice de prêt immobilier (page pret.html)
   ============================================================ */
(function (app) {
  "use strict";

  app.initLoan = function () {
    const amountInput = document.querySelector("#loan-amount");
    const yearsInput  = document.querySelector("#loan-years");
    const rateInput   = document.querySelector("#loan-rate");
    const downInput   = document.querySelector("#loan-down");
    if (!amountInput || !yearsInput || !rateInput || !downInput) return;

    const amountOut   = document.querySelector("#amount-out");
    const yearsOut    = document.querySelector("#years-out");
    const rateOut     = document.querySelector("#rate-out");
    const downOut     = document.querySelector("#down-out");
    const monthlyOut  = document.querySelector("#loan-monthly");
    const costOut     = document.querySelector("#loan-cost");
    const totalOut    = document.querySelector("#loan-total");
    const countOut    = document.querySelector("#loan-count");
    const capitalOut  = document.querySelector("#capital-value");
    const interestOut = document.querySelector("#interest-value");
    const splitBar    = document.querySelector("#split-capital");

    // Taux d'endettement inline (dans la carte résultats)
    const debtInline  = document.querySelector("#debt-inline");
    const debtRatio   = document.querySelector("#debt-ratio");
    const debtBar     = document.querySelector("#debt-bar");
    const debtAdvice  = document.querySelector("#debt-advice");

    // Cartes d'analyse
    const maxPriceOut    = document.querySelector("#max-price");
    const maxPriceSub    = document.querySelector("#max-price-sub");
    const effortOut      = document.querySelector("#effort-value");
    const effortSub      = document.querySelector("#effort-sub");
    const debtRatioCard  = document.querySelector("#debt-ratio-card");
    const debtAdviceCard = document.querySelector("#debt-advice-card");
    const mainTip        = document.querySelector("#main-tip");
    const incomeInput    = document.querySelector("#monthly-income");

    const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
    function euro(v) { return `${fmt.format(Math.round(v))} €`; }

    function compute(amount, years, rate, down) {
      const capital = Math.max(amount - down, 0);
      const months  = years * 12;
      const mr      = rate / 100 / 12;
      const monthly = mr === 0 ? capital / months : capital * mr / (1 - Math.pow(1 + mr, -months));
      const total   = monthly * months;
      return { monthly, total, cost: total - capital, capital, months };
    }

    function updateDebt(monthly, years) {
      const income = incomeInput ? Number(incomeInput.value) : 0;
      if (!income || income <= 0) {
        if (debtInline) debtInline.hidden = true;
        if (debtRatioCard) { debtRatioCard.textContent = "—"; debtRatioCard.style.color = ""; }
        if (debtAdviceCard) debtAdviceCard.textContent = "Saisissez votre revenu dans le formulaire pour voir votre taux.";
        return;
      }
      const ratio = monthly / income * 100;
      const pct   = Math.min(ratio, 100).toFixed(1);

      // Inline
      if (debtInline) debtInline.hidden = false;
      if (debtRatio) debtRatio.textContent = `${ratio.toFixed(1)} %`;
      if (debtBar) {
        debtBar.style.width = `${pct}%`;
        debtBar.style.background = ratio <= 33 ? "var(--green)" : ratio <= 40 ? "#c07a00" : "var(--accent)";
      }

      let msg, color;
      if (ratio <= 33) {
        msg = "✓ Taux acceptable (≤ 33 %). Votre dossier est solide.";
        color = "var(--green)";
      } else if (ratio <= 40) {
        msg = "⚠ Taux élevé (33–40 %). Certaines banques acceptent jusqu'à 40 % selon le reste à vivre.";
        color = "#c07a00";
      } else {
        msg = "✗ Taux trop élevé (> 40 %). Réduisez le montant ou allongez la durée.";
        color = "var(--accent)";
      }
      if (debtAdvice) debtAdvice.textContent = msg;
      if (debtRatio) debtRatio.style.color = color;

      // Carte analyse
      if (debtRatioCard) { debtRatioCard.textContent = `${ratio.toFixed(1)} %`; debtRatioCard.style.color = color; }
      if (debtAdviceCard) debtAdviceCard.textContent = msg;
    }

    function update() {
      const amount = Number(amountInput.value);
      const years  = Number(yearsInput.value);
      const rate   = Number(rateInput.value);
      const down   = Math.min(Number(downInput.value), amount);

      amountOut.textContent = euro(amount);
      yearsOut.textContent  = `${years} an${years > 1 ? "s" : ""}`;
      rateOut.textContent   = `${rate.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} %`;
      downOut.textContent   = euro(down);

      const r        = compute(amount, years, rate, down);
      const capital  = r.capital;
      const interest = r.cost;

      monthlyOut.textContent  = `${fmt.format(Math.round(r.monthly))} € / mois`;
      costOut.textContent     = euro(r.cost);
      totalOut.textContent    = euro(r.total);
      countOut.textContent    = `${r.months} mensualités`;
      capitalOut.textContent  = euro(capital);
      interestOut.textContent = euro(interest);

      const share = capital + interest > 0 ? capital / (capital + interest) : 1;
      splitBar.style.width = `${(share * 100).toFixed(1)}%`;

      // Prix max du bien
      if (maxPriceOut) {
        maxPriceOut.textContent = euro(amount);
        if (maxPriceSub) maxPriceSub.textContent = `Dont ${euro(down)} d'apport et ${euro(capital)} financés.`;
      }

      // Effort total
      if (effortOut) {
        const pct = capital > 0 ? (interest / capital * 100).toFixed(1) : 0;
        effortOut.textContent = euro(r.total);
        if (effortSub) effortSub.textContent = `Soit ${pct} % du capital en intérêts sur ${years} ans.`;
      }

      // Taux d'endettement
      updateDebt(r.monthly, years);

      // Conseil personnalisé
      if (mainTip) {
        const downPct = amount > 0 ? down / amount * 100 : 0;
        if (rate >= 5)
          mainTip.textContent = "Le taux est élevé. Faites appel à un courtier ou attendez une baisse avant de vous engager.";
        else if (downPct < 10)
          mainTip.textContent = "Apport inférieur à 10 % : l'augmenter réduira le coût total et améliorera vos conditions d'emprunt.";
        else if (years > 25)
          mainTip.textContent = "Durée très longue : raccourcir de 5 ans peut économiser plusieurs dizaines de milliers d'euros en intérêts.";
        else if (downPct >= 20 && rate < 3.5)
          mainTip.textContent = "Excellente configuration : apport ≥ 20 % et taux bas. Vous êtes en position de force pour négocier.";
        else
          mainTip.textContent = "Simulation équilibrée. Comparez au moins 3 offres bancaires et pensez à déléguer l'assurance emprunteur.";
      }
    }

    [amountInput, yearsInput, rateInput, downInput].forEach(i => i.addEventListener("input", update));
    if (incomeInput) incomeInput.addEventListener("input", update);
    update();
  };
})(window.Maison);
