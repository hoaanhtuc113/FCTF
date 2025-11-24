export interface ActionLog {
  actionId: number;
  actionType: number;
  actionDate: string;
  actionDetail: string;
  topicName: string;
  userId: number;
  userName: string;
}

export interface ActionLogResponse {
  success: boolean;
  data: ActionLog[];
  message?: string;
}

export const ACTION_TYPE_LABELS: Record<number, string> = {
  1: 'Access Challenge',
  2: 'Start Challenge',
  3: 'Correct Flag',
  4: 'Incorrect Flag',
  5: 'Unlock Hint',
};

export const ACTION_TYPE_COLORS: Record<number, string> = {
  1: 'bg-blue-100 text-blue-800',
  2: 'bg-green-100 text-green-800',
  3: 'bg-emerald-100 text-emerald-800',
  4: 'bg-red-100 text-red-800',
  5: 'bg-yellow-100 text-yellow-800',
};
