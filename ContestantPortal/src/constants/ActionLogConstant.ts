export const actionType = {
  ACCESS_CHALLENGE: 1,
  START_CHALLENGE: 2,
  CORRECT_FLAG: 3,
  INCORRECT_FLAG: 4,
  UNLOCK_HINT: 5,
} as const;

export type ActionType = typeof actionType[keyof typeof actionType];
