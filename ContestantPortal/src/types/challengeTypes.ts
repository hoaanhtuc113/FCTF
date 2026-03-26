import type { DeploymentStatus } from './deployment';

export interface Category {
  topic_name: string;
  challenge_count: number;
}

export interface ChallengeRequirements {
  prerequisites?: number[];
  anonymize?: boolean;
}

export interface Challenge {
  id: number;
  name: string;
  value: number;
  solve_by_myteam: boolean;
  solves?: number;
  time_limit: number;
  max_attempts: number;
  category: string;
  description?: string;
  files?: string[];
  type?: string;
  attemps?: number;
  require_deploy?: boolean;
  is_captain?: boolean;
  captain_only_start?: boolean;
  captain_only_submit?: boolean;
  shared_instance?: boolean;
  requirements?: ChallengeRequirements | null;
  pod_status?: DeploymentStatus | null;
}

export interface PrerequisiteChallenge {
  id: number;
  name: string;
  category: string;
  solved: boolean;
}

export interface Hint {
  id: number;
  cost: number | null;
  content?: string;
  isUnlocked?: boolean;
}

export type { DeploymentStatus };
