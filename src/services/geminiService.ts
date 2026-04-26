import { GoogleGenAI, Type } from "@google/genai";
import { NutritionData } from "../types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export async function analyzeFoodImage(base64Data: string, refinementHint?: string, correctionHistory?: string): Promise<NutritionData> {
  try {
    const ai = getAI();
    let promptText = "Analyze this food item from the image. CRITICAL: Estimate the visual portion size (e.g., half plate, small bowl, large serving) and provide a 'portionFactor' (from 0.1 to 2.0) representing the quantity. ADJUST all nutritional values (calories, macros) to reflect the actual food quantity shown in the image, not just a generic serving. Provide nutritional information including macros, fiber, sodium, and key vitamins or minerals (micronutrients) if identifiable.";
    
    if (correctionHistory) {
      promptText += `\n\nLEARNING FROM USER: Here are some past food items this user has corrected. If the current food is similar, use these corrected values as a reference for more accurate estimation:\n${correctionHistory}`;
    }

    if (refinementHint) {
      promptText += `\n\nUSER FEEDBACK: The previous analysis was reported as inaccurate. Please re-analyze carefully. HINT/CORRECTION from user: "${refinementHint}". Use this hint to provide a more accurate estimation.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: "image/jpeg",
              },
            },
            {
              text: promptText,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            foodName: { type: Type.STRING },
            calories: { type: Type.NUMBER, description: "Calories in kcal adjusted for the portion seen in image" },
            protein: { type: Type.NUMBER, description: "Protein in grams adjusted for portion" },
            carbs: { type: Type.NUMBER, description: "Carbohydrates in grams adjusted for portion" },
            fat: { type: Type.NUMBER, description: "Fat in grams adjusted for portion" },
            fiber: { type: Type.NUMBER, description: "Fiber in grams adjusted for portion" },
            sodium: { type: Type.NUMBER, description: "Sodium in mg adjusted for portion" },
            estimatedPortion: { type: Type.STRING, description: "Description of portion detected e.g. 'Large Plate', 'Half Serving'" },
            portionFactor: { type: Type.NUMBER, description: "The multiplier used for calculation e.g. 0.5, 1.2" },
            description: { type: Type.STRING, description: "A short appetizing summary" },
            ingredients: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Array of main ingredients with their corresponding emoji icons"
            },
            micronutrients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "e.g., Vitamin C, Iron" },
                  value: { type: Type.STRING, description: "e.g., 20mg, 15% DV" }
                },
                required: ["name", "value"]
              },
              description: "List of vitamins and minerals found in the food"
            }
          },
          required: ["foodName", "calories", "protein", "carbs", "fat", "description", "ingredients"],
        },
      },
    });

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    return JSON.parse(response.text.trim()) as NutritionData;
  } catch (error) {
    console.error("Error analyzing food image:", error);
    throw error;
  }
}
