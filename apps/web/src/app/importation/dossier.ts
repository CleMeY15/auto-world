export type SellerKind = "unknown" | "professional" | "private";

const proofOfPurchase = {
  unknown: {
    id: "purchase-proof",
    label: "Justificatif d’achat",
    detail: "Identifiez la pièce à obtenir selon le type de vendeur : facture d’un professionnel ou certificat de cession d’un particulier.",
  },
  professional: {
    id: "dealer-invoice",
    label: "Facture du professionnel",
    detail: "Demandez la facture au vendeur et gardez-en une copie pour le dossier français.",
  },
  private: {
    id: "private-sale",
    label: "Certificat de cession du particulier",
    detail: "Préparez le certificat de cession avec le vendeur et conservez votre exemplaire signé.",
  },
} as const;

export function getImportGroups(seller: SellerKind) {
  return [
    {
      id: "vendeur",
      title: "À demander au vendeur",
      items: [
        {
          id: "registration",
          label: "Certificat d’immatriculation allemand",
          detail: "Sur le titre allemand actuel, recherchez les deux volets : Teil I et Teil II. Si une autorité a conservé le titre, vérifiez le justificatif admis sur Service Public.",
        },
        proofOfPurchase[seller],
      ],
    },
    {
      id: "vehicule",
      title: "À vérifier sur la voiture",
      items: [
        {
          id: "inspection",
          label: "Validité du contrôle technique",
          detail: "Vérifiez si la voiture est dispensée. Pour une voiture de plus de quatre ans soumise au contrôle, le procès-verbal doit avoir moins de six mois au dépôt. En cas de contre-visite, son délai doit rester valable. Un contrôle réalisé en Allemagne peut convenir.",
        },
        {
          id: "conformity",
          label: "Justificatif de conformité adapté",
          detail: "Identifiez la preuve admise pour cette voiture avec la fiche officielle : certificat de conformité européen, attestation ou autre justificatif selon le cas.",
        },
      ],
    },
    {
      id: "france",
      title: "À préparer en France",
      items: [
        {
          id: "residence",
          label: "Pièce d’identité et justificatif de domicile",
          detail: "Préparez votre pièce d’identité et un justificatif de domicile de moins de six mois pour la demande d’immatriculation.",
        },
        {
          id: "tax-procedure",
          label: "Procédure de quitus pour mon département",
          detail: "Repérez sur Service Public la démarche qui correspond à votre domicile. Selon le département, la demande se fait séparément ou avec l’immatriculation.",
        },
      ],
    },
  ];
}
