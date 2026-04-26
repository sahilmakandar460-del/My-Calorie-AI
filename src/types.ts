export interface Micronutrient {
  name: string;
  value: string;
}

export interface NutritionData {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodium?: number;
  description: string;
  ingredients: string[];
  micronutrients?: Micronutrient[];
  estimatedPortion?: string; // e.g., "Half Plate", "Medium Serving"
  portionFactor?: number;    // e.g., 0.55, 1.0
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  earnedAt?: number;
}

export interface MealHistoryItem extends NutritionData {
  id: string;
  userId: string;
  timestamp: number;
  date: string; // YYYY-MM-DD
  imageUrl?: string;
  isCorrected?: boolean;
}

export interface WeightEntry {
  id: string;
  userId: string;
  weight: number;
  targetWeight: number;
  date: string;
  timestamp: number;
}

export interface UserSettings {
  dailyGoal: number;
  waterGoal?: number;
  email?: string;
  waterIntake?: number;
  lastResetDate?: string;
  notifiedToday?: boolean;
  waterRemindersEnabled?: boolean;
  reminderInterval?: number; // in minutes
  theme?: 'dark' | 'light';
  breakfastReminder?: string; // HH:mm
  lunchReminder?: string;
  dinnerReminder?: string;
  mealRemindersEnabled?: boolean;
  firstUsedTimestamp?: number;
  hasRated?: boolean;
  targetWeight?: number;
  streak?: number;
  lastLogDate?: string;
  goalMetDays?: number;
  uniqueFoods?: string[];
  badges?: string[];
  logoUrl?: string;
}

export interface AIFeedback {
  id: string;
  mealId: string;
  foodName: string;
  originalCalories: number;
  correctedCalories: number;
  isAccurate: boolean;
  timestamp: number;
  userId: string;
}
