window.Maison = {
  whatsappPhone: "237672389000",
  facebookUrl: "https://www.facebook.com/",
  instagramUrl: "https://www.instagram.com/",
  properties: [
    {
      id: "maison-verger", title: "La maison du verger", location: "France · Bordeaux",
      price: 485000, currency: "EUR", currencySymbol: "€", operation: "sale",
      kind: "maison", kindLabel: "Maison", image: "assets/images/maison-verger.webp",
      alt: "Maison en pierre claire avec jardin", rooms: 5, bedrooms: 4, bathrooms: 2, area: 142,
      description: "Une maison familiale baignée de lumière, avec de beaux volumes et un jardin arboré au calme.",
      isNew: true,
      features: ["Jardin arboré", "Terrasse", "Garage"], label: "À vendre", order: 1
    },
    {
      id: "appartement-lumiere", title: "L'appartement lumière", location: "France · Lyon",
      price: 1350, currency: "EUR", currencySymbol: "€", operation: "rent",
      kind: "appartement", kindLabel: "Appartement", image: "assets/images/appartement.webp",
      alt: "Appartement lumineux aux grandes fenêtres", rooms: 3, bedrooms: 2, bathrooms: 1, area: 78,
      description: "Un appartement traversant rénové, avec une pièce de vie ouverte et une vue dégagée sur les toits.",
      features: ["Balcon", "Cuisine équipée", "Cave"], label: "À louer", order: 2, priceSuffix: " / mois"
    },
    {
      id: "villa-des-pins", title: "La villa des pins", location: "France · Aix-en-Provence",
      price: 695000, currency: "EUR", currencySymbol: "€", operation: "sale",
      kind: "maison", kindLabel: "Villa", image: "assets/images/villa.webp",
      alt: "Villa provençale moderne entourée d'arbres", rooms: 6, bedrooms: 4, bathrooms: 3, area: 176,
      description: "Une villa élégante entre nature et ville, idéale pour profiter du soleil provençal en toute tranquillité.",
      isExclusive: true,
      features: ["Piscine", "Jardin", "Suite parentale"], label: "À vendre", order: 3
    },
    {
      id: "maison-terrasse", title: "La maison terrasse", location: "France · Nantes",
      price: 1850, currency: "EUR", currencySymbol: "€", operation: "rent",
      kind: "maison", kindLabel: "Maison", image: "assets/images/maison-terrasse.webp",
      alt: "Maison contemporaine avec terrasse végétalisée", rooms: 4, bedrooms: 3, bathrooms: 2, area: 112,
      description: "Une maison contemporaine aux espaces bien pensés, prolongée par une terrasse intime et végétalisée.",
      features: ["Terrasse", "Lumineuse", "Quartier calme"], label: "À louer", order: 4, priceSuffix: " / mois"
    },
    {
      id: "loft-atelier", title: "Le loft atelier", location: "France · Lille",
      price: 329000, currency: "EUR", currencySymbol: "€", operation: "sale",
      kind: "loft", kindLabel: "Loft", image: "assets/images/loft.webp",
      alt: "Loft chaleureux avec poutres apparentes", rooms: 3, bedrooms: 2, bathrooms: 1, area: 96,
      description: "Un loft de caractère qui marie poutres apparentes, matériaux chaleureux et confort contemporain.",
      features: ["Belle hauteur sous plafond", "Poutres apparentes", "Centre historique"], label: "À vendre", order: 5
    },
    {
      id: "duplex-jardin", title: "Le duplex jardin", location: "France · Toulouse",
      price: 1180, currency: "EUR", currencySymbol: "€", operation: "rent",
      kind: "appartement", kindLabel: "Duplex", image: "assets/images/duplex.webp",
      alt: "Pièce de vie ouverte sur un jardin", rooms: 3, bedrooms: 2, bathrooms: 1, area: 84,
      description: "Un duplex chaleureux ouvert sur un jardin privatif, dans une résidence à taille humaine.",
      features: ["Jardin privatif", "Rangements", "Stationnement"], label: "À louer", order: 6, priceSuffix: " / mois"
    },
    {
      id: "villa-douala", title: "Villa résidentielle", location: "Cameroun · Douala",
      price: 85000000, currency: "XAF", currencySymbol: "FCFA", operation: "sale",
      kind: "maison", kindLabel: "Villa", image: "assets/images/villa.webp",
      alt: "Villa moderne à Douala", rooms: 5, bedrooms: 4, bathrooms: 3, area: 200,
      description: "Belle villa moderne dans un quartier résidentiel sécurisé de Douala, avec piscine et grand jardin.",
      isNew: true,
      features: ["Piscine", "Gardiennage", "Groupe électrogène"], label: "À vendre", order: 7
    },
    {
      id: "appart-abidjan", title: "Appartement standing", location: "Côte d'Ivoire · Abidjan",
      price: 450000, currency: "XAF", currencySymbol: "FCFA", operation: "rent",
      kind: "appartement", kindLabel: "Appartement", image: "assets/images/appartement.webp",
      alt: "Appartement moderne à Abidjan", rooms: 3, bedrooms: 2, bathrooms: 2, area: 95,
      description: "Appartement haut standing en plein cœur du Plateau, vue panoramique sur la lagune.",
      features: ["Vue lagune", "Climatisation", "Parking"], label: "À louer", order: 8, priceSuffix: " / mois"
    },
    {
      id: "riad-marrakech", title: "Riad authentique", location: "Maroc · Marrakech",
      price: 3200000, currency: "MAD", currencySymbol: "DH", operation: "sale",
      kind: "maison", kindLabel: "Riad", image: "assets/images/interieur.webp",
      alt: "Riad traditionnel à Marrakech", rooms: 6, bedrooms: 5, bathrooms: 4, area: 280,
      description: "Magnifique riad en pleine médina, entièrement rénové avec matériaux traditionnels et confort moderne.",
      isExclusive: true,
      features: ["Patio central", "Terrasse panoramique", "Hammam"], label: "À vendre", order: 9
    },
    {
      id: "appart-geneve", title: "Appartement lac Léman", location: "Suisse · Genève",
      price: 4200, currency: "CHF", currencySymbol: "CHF", operation: "rent",
      kind: "appartement", kindLabel: "Appartement", image: "assets/images/loft.webp",
      alt: "Appartement avec vue sur le lac Léman", rooms: 4, bedrooms: 3, bathrooms: 2, area: 120,
      description: "Appartement lumineux avec vue imprenable sur le lac Léman, à deux pas du centre-ville.",
      features: ["Vue lac", "Balcon", "Cave"], label: "À louer", order: 10, priceSuffix: " / mois"
    },
    {
      id: "penthouse-dubai", title: "Penthouse Downtown", location: "Dubaï · UAE",
      price: 4500000, currency: "AED", currencySymbol: "AED", operation: "sale",
      kind: "appartement", kindLabel: "Penthouse", image: "assets/images/maison-hero.webp",
      alt: "Penthouse avec vue sur Burj Khalifa", rooms: 5, bedrooms: 4, bathrooms: 4, area: 320,
      description: "Penthouse d'exception avec vue directe sur le Burj Khalifa, finitions luxueuses et terrasse privative.",
      isNew: true,
      features: ["Vue Burj Khalifa", "Piscine privée", "Conciergerie 24h"], label: "À vendre", order: 11
    },
    {
      id: "maison-montreal", title: "Maison plateau", location: "Canada · Montréal",
      price: 2800, currency: "CAD", currencySymbol: "CA$", operation: "rent",
      kind: "maison", kindLabel: "Maison", image: "assets/images/maison-terrasse.webp",
      alt: "Maison typique du Plateau Mont-Royal", rooms: 4, bedrooms: 3, bathrooms: 2, area: 130,
      description: "Maison typique du Plateau Mont-Royal avec terrasse arrière, à deux pas des restaurants et cafés.",
      features: ["Terrasse", "Sous-sol aménagé", "Quartier branché"], label: "À louer", order: 12, priceSuffix: " / mois"
    }
  ]
};

// Charge les annonces depuis la base (API). En cas d'échec, les annonces d'exemple ci-dessus restent affichées.
window.Maison.loadRemote = async function () {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const response = await fetch("/api/properties", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!response.ok) return;
    const rows = await response.json();
    if (Array.isArray(rows)) window.Maison.properties = rows;
  } catch (error) { /* site statique : on garde les données locales */ }
};
