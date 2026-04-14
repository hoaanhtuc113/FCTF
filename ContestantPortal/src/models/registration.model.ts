export type RegistrationFieldType = 'text' | 'boolean';

export interface RegistrationFieldDefinition {
  id: number;
  name: string;
  fieldType: RegistrationFieldType;
  description?: string;
  required: boolean;
}

export interface RegistrationConstraints {
  teamSizeLimit: number;
  numTeamsLimit: number;
  numUsersLimit: number;
}

export interface RegistrationMetadata {
  userFields: RegistrationFieldDefinition[];
  teamFields: RegistrationFieldDefinition[];
  constraints: RegistrationConstraints;
}

export interface RegistrationFieldValue {
  fieldId: number;
  value: string | boolean;
}

export interface RegisterContestantMemberPayload {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  userFields: RegistrationFieldValue[];
}

export interface RegisterContestantPayload {
  teamName: string;
  teamEmail?: string;
  teamPassword?: string;
  captchaToken?: string;
  teamFields: RegistrationFieldValue[];
  members: RegisterContestantMemberPayload[];
}
