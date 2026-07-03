export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  nextEligibleDate?: Date;
  needsMedicalScreening?: boolean;
  needsHealthScreening?: boolean;
  suggestReminder?: boolean;
  disqualifyingFactors?: string[];
  screeningDate?: Date;
  eligibilityExpiry?: Date;
}

export interface EligibilityStatusResponse {
  eligible: boolean;
  lastChecked: string;
  eligibilityExpiry: string | null;
  donationCooldown: {
    onCooldown: boolean;
    lastDonationDate: string | null;
    daysSinceLastDonation: number | null;
    nextEligibleDate: string | null;
  };
  medicalScreening: {
    verified: boolean;
    expiryDate: string | null;
  };
  healthScreening: {
    completed: boolean;
    passed: boolean | null;
    date: string | null;
  };
}

export interface DocumentStatusEntry {
  id: string;
  verified: boolean;
  expiryDate: string | null;
}

export interface DocumentStatusResponse {
  documentsAvailable: boolean;
  existingDocuments: {
    idProof?: DocumentStatusEntry;
    bloodGroupProof?: DocumentStatusEntry;
    medicalScreening?: DocumentStatusEntry;
  };
  needsDocuments: string[];
  canProceed: boolean;
}

export interface HealthScreeningInput {
  height?: number;
  weight?: number;
  bloodPressure?: string;
  hemoglobinLevel?: number;
  pulseRate?: number;
  temperature?: number;

  hasHeartDisease: boolean;
  hasDiabetes: boolean;
  hasHepatitis: boolean;
  hasHiv: boolean;
  hasTuberculosis: boolean;
  hasCancer: boolean;
  hasBleedingDisorder: boolean;
  hasSeizureDisorder: boolean;
  hasKidneyDisease: boolean;
  hasLiverDisease: boolean;
  hasRespiratoryDisease: boolean;
  hasAutoimmuneDisease: boolean;

  hasRecentSurgery: boolean;
  recentSurgeryDate?: string;
  hasRecentTattoo: boolean;
  recentTattooDate?: string;
  hasRecentPiercing: boolean;
  recentPiercingDate?: string;
  hasRecentTravel: boolean;
  recentTravelCountry?: string;
  hasRecentVaccination: boolean;
  recentVaccinationDate?: string;

  hasDonatedBefore: boolean;
  hasAdverseReaction: boolean;
  adverseReactionDetail?: string;
  isOnMedication: boolean;
  medicationDetails?: string;
  isPregnant: boolean;
  isBreastfeeding: boolean;
  hasConsumedAlcohol24h: boolean;
  hasFever: boolean;
}
