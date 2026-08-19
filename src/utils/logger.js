import { historyLogs } from "../db/schema.js";

/**
 * Reusable history writer
 * @param {object} databaseConnection - The active database connection (either 'db' or 'tx')
 */
export const addHistory = async (databaseConnection, userId, feature, action, message, extraDetails = {}) => {
  try {
    // This inserts a new line into our Master Logbook
    await databaseConnection.insert(historyLogs).values({
      userId: userId,
      feature: feature.toUpperCase(),
      action: action.toUpperCase(),
      message: message,
      metadata: extraDetails, // Save the custom details here
    });
  } catch (error) {
    console.error("Failed to write history:", error);
  }
};
